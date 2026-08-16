import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Turns the screenshots the Playwright run just produced into one page to open.
 *
 * Generated rather than hand-written so it cannot drift: it lists what is actually
 * on disk, and a shot that stops being taken disappears from the page instead of
 * becoming a broken image. A caption it does not recognise is flagged rather than
 * silently left blank — an unexplained screenshot is decoration.
 *
 *   node e2e/build-review-page.mjs        (or: pnpm ui:review from the root)
 */
const ROOT = join(process.cwd(), '..', 'docs', 'ui-review');
const SHOTS = join(ROOT, 'screenshots');

/** What each shot is evidence of. Keyed by file name without the extension. */
const CAPTIONS = {
  '01-picker-initial': {
    title: 'Nothing chosen yet',
    body: 'The landing state. The user card refuses to guess — it says to choose a tenant first, because listing users needs one.',
  },
  '02-tenant-created-no-users': {
    title: 'A tenant with no users',
    body: 'Creating a tenant selects it, and the empty user list says what to do next rather than showing a blank area. Behind this, identity has already published <code>identity.tenant-created.v1</code> and messaging has provisioned the tenant’s search alias.',
  },
  '03-user-selected': {
    title: 'A user to act as',
    body: 'Each option carries its email, because two people called Alice is the normal case and an opaque id is not a choice anyone can make.',
  },
  '04-token-issued': {
    title: 'A token, masked',
    body: 'The badges say what is held. The token is masked by default: a screenshot of this page, or a shoulder behind it, should not be a credential leak.',
  },
  '05-token-revealed': {
    title: 'Revealed and copyable',
    body: 'Shown on request. Truncated on screen, whole in the clipboard — what you copy is never less than what you were shown.',
  },
  '06-after-reload-token-gone': {
    title: 'Reload, and it is gone',
    body: 'Held in memory only. These endpoints issue a token for anyone who is named, so one that survives a reload is one nobody meant to keep.',
  },
  '07-tenants-failed': {
    title: 'Identity unreachable',
    body: 'The state nobody clicks through by hand, which is why it is the one that ships broken. The message is the server’s own, and there is a way back.',
  },
  '08-picker-light': {
    title: 'Light',
    body: 'Tokens are defined light-first and swapped under <code>prefers-color-scheme</code>.',
  },
  '09-picker-dark': {
    title: 'Dark',
    body: 'Lifted, desaturated accents rather than the light values inverted — the same hue at full saturation on a dark surface vibrates and loses contrast.',
  },
  '10-health-dark': {
    title: 'Health, dark',
    body: 'Both services through the one proxy. The status is a word as well as a colour.',
  },
  '11-health-light': {
    title: 'Health, light',
    body: 'The same page in the other theme, checked rather than assumed.',
  },
  '12-picker-narrow': {
    title: '375px',
    body: 'The rows wrap instead of scrolling sideways. The test asserts that too — <code>scrollWidth</code> may not exceed <code>clientWidth</code>.',
  },
};

const shots = readdirSync(SHOTS)
  .filter((file) => file.endsWith('.png'))
  .sort();

if (shots.length === 0) {
  throw new Error(`No screenshots in ${SHOTS}. Run \`pnpm e2e\` in ui/ first.`);
}

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const figures = shots
  .map((file) => {
    const key = file.replace(/\.png$/, '');
    const caption = CAPTIONS[key];
    const title = caption ? escape(caption.title) : escape(key);
    // Captions carry deliberate <code> markup, so they are not escaped; the
    // unknown-key fallback is, since it comes from a file name.
    const body = caption
      ? caption.body
      : '<em>No caption for this shot — add one in e2e/build-review-page.mjs.</em>';

    return `      <figure>
        <img src="screenshots/${file}" alt="${title}" loading="lazy" />
        <figcaption><strong>${title}</strong><span>${body}</span></figcaption>
      </figure>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demo UI — review</title>
    <style>
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
      .shots { display: grid; gap: 32px; margin-top: 32px; }
      figure { margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
      img { display: block; width: 100%; height: auto; border-bottom: 1px solid var(--border); }
      figcaption { display: grid; gap: 4px; padding: 14px 18px; }
      figcaption strong { font-size: 14px; }
      figcaption span { font-size: 14px; color: var(--muted); }
      footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
      a { color: var(--accent); }
    </style>
  </head>
  <body>
    <main>
      <h1>Demo UI — review</h1>
      <p class="lede">
        Every screenshot below was taken by a real Chromium driving the
        <code>demo-ui</code> container, not the dev server — what a reviewer opens
        is the nginx image, and the two differ in the proxy prefixes that have
        already caught this project out once.
      </p>
      <p class="lede">
        They are the output of assertions, not a separate exercise: each one is
        taken at a point the test has just proved something about, so a shot that
        stops being possible fails the run rather than quietly going stale.
      </p>
      <p class="lede">
        Regenerate with <code>pnpm ui:e2e &amp;&amp; pnpm ui:review</code> from the
        repository root, with the stack up.
      </p>

      <div class="shots">
${figures}
      </div>

      <footer>
        ${shots.length} screenshots · generated from <code>ui/e2e/picker.spec.ts</code> ·
        this page is written by <code>ui/e2e/build-review-page.mjs</code> and should not be edited by hand
      </footer>
    </main>
  </body>
</html>
`;

writeFileSync(join(ROOT, 'index.html'), html);
console.log(`Wrote ${join(ROOT, 'index.html')} with ${shots.length} screenshots.`);

const missing = shots.filter((file) => !CAPTIONS[file.replace(/\.png$/, '')]);
if (missing.length > 0) {
  console.warn(`No caption for: ${missing.join(', ')}`);
}
