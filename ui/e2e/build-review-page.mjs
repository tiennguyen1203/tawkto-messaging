import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Turns the screenshots the Playwright run just produced into pages to open.
 *
 * One page per subject rather than one long scroll: a reviewer looking at search
 * should not have to walk past eight pictures of the picker to reach it. `index.html`
 * is a contents page and holds no screenshots of its own.
 *
 * Generated rather than hand-written so it cannot drift: it lists what is actually
 * on disk, a shot that stops being taken disappears instead of becoming a broken
 * image, and one that appears without a caption is reported rather than shown blank.
 *
 *   node e2e/build-review-page.mjs        (or: pnpm ui:review from the root)
 */
const ROOT = join(process.cwd(), '..', 'docs', 'ui-review');
const SHOTS = join(ROOT, 'screenshots');

/** What each shot is evidence of. Keyed by file name without the extension. */
const CAPTIONS = {
  '30-signed-out': {
    title: 'Before anyone is signed in',
    body: 'Messaging reads the tenant out of the token on every request, so the app says what is missing rather than showing an empty shell that looks broken.',
  },
  '31-switcher-open': {
    title: 'The switcher, top right',
    body: 'Where an account menu lives in every product anyone has used. It carries the seeding too — making a tenant or a person is the same errand as choosing one, and splitting them across two places means walking back and forth. Adding somebody selects them and takes their token in the same motion.',
  },
  '32-no-chats': {
    title: 'Signed in, no chats',
    body: '<code>GET /conversations</code> returns only the caller’s own, so an empty rail is the honest answer rather than a filtered one.',
  },
  '33-empty-chat': {
    title: 'A new conversation',
    body: '<code>POST /conversations</code>; the creator is added automatically, so only the other person is chosen. The header names them — it showed a fragment of their id until a test asserted otherwise.',
  },
  '34-chat-first-page': {
    title: 'One page of messages',
    body: 'Seven <code>POST /messages</code>, then <code>GET /conversations/:id/messages</code>. Five per page, deliberately tiny: at a sensible page size, cursor pagination is invisible in a demo. Sender and timestamp are the server’s, never the client’s.',
  },
  '35-chat-after-paging': {
    title: 'The rest, by cursor',
    body: 'Keyset pagination, not an offset: the cursor is the last row’s timestamp and id, so a message arriving mid-read cannot shift a page and hide a row (ADR-004).',
  },
  '36-search-results': {
    title: 'Search inside the conversation',
    body: '<code>GET /conversations/:id/messages/search?q=</code>, taking over the thread while it has a query. Mongo → Debezium → Kafka → Elasticsearch means a message sent a second ago is not findable yet, so the test polls rather than sleeping.',
  },
  '37-isolation-proved': {
    title: 'Refused twice, for two different reasons',
    body: 'Each button mints a real second identity and asks for this same conversation. Another tenant gets <strong>404</strong> — even its existence belongs to its owner. A colleague in the tenant who is not a participant gets <strong>403</strong>. <strong>This panel found a real hole:</strong> both read paths checked the tenant and stopped there, so any token for a tenant could read any conversation in it by id. Fixed, and held by three tests.',
  },
  '38-as-the-other-person': {
    title: 'The same conversation, as Bob',
    body: 'One click in the switcher. A different token, a different list from <code>GET /conversations</code>, the same thread from the other side — which is the whole reason the switcher is in the header rather than on a page of its own.',
  },
  '39-reply-from-bob': {
    title: 'A reply',
    body: 'Own messages sit right and tinted, and still say who sent them: side and colour are both invisible to a screen reader.',
  },
  '40-messenger-light': {
    title: 'Light',
    body: 'Tokens are defined light-first and swapped under <code>prefers-color-scheme</code>.',
  },
  '41-messenger-dark': {
    title: 'Dark',
    body: 'Lifted, desaturated accents rather than the light values inverted — the same hue at full saturation on a dark surface vibrates and loses contrast.',
  },
  '42-messenger-narrow': {
    title: '390px',
    body: 'The rail stacks above the thread instead of squeezing beside it. The test asserts it too: <code>scrollWidth</code> may not exceed <code>clientWidth</code>.',
  },
};

/** One page each. A shot not claimed by a group is reported, never dropped. */
const PAGES = [
  {
    file: 'messenger.html',
    title: 'The messenger',
    blurb:
      'Switch identity from the header, start a chat, post into it, page back through it by cursor, search it, and read the same conversation as the other person. The three endpoints the brief grades, driven through the interface rather than described.',
    match: (name) => /^(3[0-6]|38|39|4\d)-/.test(name),
  },
  {
    file: 'refusals.html',
    title: 'What the API refuses',
    blurb:
      'The two callers messaging must turn away, and why each gets a different answer. This page is the reason a real authorisation hole was found and fixed.',
    match: (name) => /^37-/.test(name),
  },
];

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STYLE = `
      :root {
        color-scheme: light dark;
        --bg: #f6f7f9; --surface: #fff; --border: #d3d8e0;
        --text: #14181f; --muted: #5b6472; --accent: #2454c7;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        line-height: 1.5;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0f1216; --surface: #171b21; --border: #2a313b;
          --text: #e6e9ee; --muted: #9aa4b2; --accent: #7aa2f7;
        }
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--text); }
      main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
      h1 { font-size: 22px; margin: 0 0 8px; }
      .lede { color: var(--muted); margin: 0 0 8px; max-width: 68ch; }
      code {
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 0.9em; background: color-mix(in srgb, var(--border) 45%, transparent);
        padding: 1px 5px; border-radius: 4px;
      }
      nav.crumb { margin-bottom: 20px; font-size: 14px; }
      .cards { display: grid; gap: 16px; margin-top: 28px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .cards a {
        display: grid; gap: 6px; padding: 18px; text-decoration: none;
        background: var(--surface); border: 1px solid var(--border); border-radius: 10px; color: var(--text);
      }
      .cards a:hover { border-color: var(--accent); }
      .cards strong { font-size: 15px; }
      .cards span { font-size: 14px; color: var(--muted); }
      .cards em { font-size: 13px; color: var(--muted); font-style: normal; }
      .shots { display: grid; gap: 32px; margin-top: 28px; }
      figure { margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
      img { display: block; width: 100%; height: auto; border-bottom: 1px solid var(--border); }
      figcaption { display: grid; gap: 4px; padding: 14px 18px; }
      figcaption strong { font-size: 14px; }
      figcaption span { font-size: 14px; color: var(--muted); }
      footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
      a { color: var(--accent); }
`;

const document_ = (title, body) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)}</title>
    <style>${STYLE}    </style>
  </head>
  <body>
    <main>
${body}
    </main>
  </body>
</html>
`;

const figureFor = (file) => {
  const key = file.replace(/\.png$/, '');
  const caption = CAPTIONS[key];
  const title = caption ? escape(caption.title) : escape(key);
  // Captions carry deliberate <code> and <strong>, so they are not escaped; the
  // unknown-key fallback is, since it comes from a file name.
  const body = caption
    ? caption.body
    : '<em>No caption for this shot — add one in e2e/build-review-page.mjs.</em>';

  return `        <figure>
          <img src="screenshots/${file}" alt="${title}" loading="lazy" />
          <figcaption><strong>${title}</strong><span>${body}</span></figcaption>
        </figure>`;
};

const shots = readdirSync(SHOTS)
  .filter((file) => file.endsWith('.png'))
  .sort();

if (shots.length === 0) {
  throw new Error(`No screenshots in ${SHOTS}. Run \`pnpm e2e\` in ui/ first.`);
}

const written = [];

for (const page of PAGES) {
  const mine = shots.filter((file) => page.match(file));
  if (mine.length === 0) {
    console.warn(`No screenshots matched ${page.file}; skipping it.`);
    continue;
  }

  writeFileSync(
    join(ROOT, page.file),
    document_(
      `${page.title} — demo UI review`,
      `      <nav class="crumb"><a href="index.html">← All pages</a></nav>
      <h1>${escape(page.title)}</h1>
      <p class="lede">${page.blurb}</p>

      <div class="shots">
${mine.map(figureFor).join('\n')}
      </div>

      <footer>
        ${mine.length} screenshots · generated by <code>ui/e2e/build-review-page.mjs</code>, do not edit by hand
      </footer>`,
    ),
  );
  written.push({ ...page, count: mine.length });
}

const orphans = shots.filter((file) => !PAGES.some((page) => page.match(file)));

writeFileSync(
  join(ROOT, 'index.html'),
  document_(
    'Demo UI — review',
    `      <h1>Demo UI — review</h1>
      <p class="lede">
        Every screenshot behind these pages was taken by a real Chromium driving the
        <code>demo-ui</code> container, not the dev server — what a reviewer opens is
        the nginx image, and the two differ in the proxy prefixes that have already
        caught this project out once.
      </p>
      <p class="lede">
        They are the output of assertions, not a separate exercise: each is taken at
        a point the test has just proved something about, so a shot that stops being
        possible fails the run rather than quietly going stale. Two of them are here
        because looking at pictures found defects a green suite did not — a health
        badge painted red for a healthy service, and a read path that let any token
        in a tenant read any conversation in it.
      </p>
      <p class="lede">
        Regenerate with <code>pnpm ui:e2e &amp;&amp; pnpm ui:review</code> from the
        repository root, with the stack up.
      </p>

      <div class="cards">
${written
  .map(
    (page) => `        <a href="${page.file}">
          <strong>${escape(page.title)}</strong>
          <span>${page.blurb}</span>
          <em>${page.count} screenshots</em>
        </a>`,
  )
  .join('\n')}
      </div>
${
  orphans.length
    ? `
      <p class="lede"><strong>Not on any page:</strong> ${orphans
        .map((file) => `<code>${escape(file)}</code>`)
        .join(', ')} — add a group in <code>build-review-page.mjs</code>.</p>`
    : ''
}
      <footer>
        ${shots.length} screenshots across ${written.length} pages · generated by
        <code>ui/e2e/build-review-page.mjs</code>, do not edit by hand
      </footer>`,
  ),
);

console.log(
  `Wrote index.html and ${written.length} pages (${shots.length} screenshots) into ${ROOT}.`,
);

const missing = shots.filter((file) => !CAPTIONS[file.replace(/\.png$/, '')]);
if (missing.length > 0) {
  console.warn(`No caption for: ${missing.join(', ')}`);
}
if (orphans.length > 0) {
  console.warn(`On no page: ${orphans.join(', ')}`);
}
