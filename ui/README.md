# Demo UI

A client of the two services, and not a bounded context. It exists so a reviewer can
become somebody without reaching for `curl`.

**Deliberately outside the pnpm workspace**, with its own manifest, lockfile,
tsconfig and eslint config. The server's `src/` is one TypeScript program with
`rootDir: src`, and a `.vue` file in it breaks the build; a separate manifest also
keeps Vue and Vite out of the dependency graph the API image installs from. Separate
has to mean self-contained — sitting inside the repository, a missing dependency
here resolves upwards into the server's `node_modules` and passes on a developer's
machine while failing in Docker, where this is built alone.

```bash
pnpm --dir ui install
pnpm ui:dev        # from the repository root — http://localhost:5173
pnpm ui:test       # unit
pnpm ui:e2e        # Playwright, against the running demo-ui container
pnpm ui:review     # turns the screenshots it took into docs/ui-review/index.html
```

`e2e/` drives the container rather than the dev server, because the container is
what a reviewer opens and the two differ in exactly the way that has caught this
project out before — the proxy prefixes. Point `BASE_URL` at `:5173` to run it
against Vite instead. The screenshots are the point as much as the assertions: they
are taken where a test has just proved something, so they cannot drift, and they
cover the states nobody clicks through by hand.

Vite proxies `/identity-api` to identity (3001) and `/api` to messaging (3000) — two
prefixes because both services answer on `/api/health`, so the path alone cannot say
which is meant. Same origin either way, so neither service needs a CORS policy. See
PLAN §10b for why that is a proxy rather than a gateway.

In a container it is `demo-ui`: nginx serving the built assets and proxying the same
two prefixes, from [Dockerfile](Dockerfile) with this directory as the whole build
context. [nginx.conf](nginx.conf) is the production half of what `vite.config.ts`
does in development, and the two are meant to be read together — if one gains a
prefix, so must the other.

## Layout

| | |
|---|---|
| `api/` | The typed client, the response envelope, and the `useRequest` loading/error convention |
| `components/` | The shared components below. No page-specific knowledge, no fetching |
| `pages/` | One file per route. Fetches, composes components, decides nothing about colour |
| `pages/messaging/` | The one page big enough to split: the stream, the search and the isolation probes |
| `session/` | Who you are acting as. In memory only — a reload asks again |
| `e2e/` | Playwright, and the script that turns its screenshots into the review pages |
| `shell/` | The frame around the router |
| `styles.css` | Every design token. A component defines no colour of its own |

## The component layer

Built before the first real page, because the picker and the messaging pane will
each need the same six things, and the second one to be written is where the
inconsistency creeps in.

| Component | Why it exists |
|---|---|
| `BaseSpinner` | One spinner. Silent to assistive technology — the component that owns the wait sets `aria-busy` |
| `BaseField` | Label, hint, error, and the `for`/`aria-describedby` wiring between them. The wiring is the part that gets forgotten |
| `BaseButton` | Variants, and a loading state that disables the button so an impatient second click cannot submit twice |
| `BaseInput` / `BaseSelect` | `v-model` over `BaseField`. A native `<select>`, not a rebuilt listbox |
| `BaseCard` | The one place a border, a radius and a padding are decided |
| `BaseBadge` | A status whose text carries the meaning, so the colour is decoration |
| `EmptyState` | What a list says when it is empty, including what to do about it |
| `AsyncPanel` | Waiting, failed, empty, ready — the four states, so no page forgets one |
| `CopyableValue` | Tokens and ids: truncated on screen, whole in the clipboard, maskable |

Conventions they all follow, and the reasons:

- **Tokens only.** Colour, spacing and motion come from `styles.css`, which defines a
  light palette and swaps it under `prefers-color-scheme: dark`. A reviewer on a
  light machine should see a designed interface, not an inverted one.
- **Never colour alone.** Every state that matters is also a word — a badge says
  `ok`, an invalid field carries `aria-invalid` and a message.
- **One root element per component.** A comment above the root makes the component a
  fragment, and a fragment has no root for `aria-busy` or for any attribute a caller
  passes down. This was caught by a test, not by review.
- **No prop mutation.** `update:modelValue`, so the parent owns the value.
- **Focus rings are replaced, never removed.**

The tests cover behaviour rather than appearance: what a component emits, what it
refuses to emit, and the attributes that decide whether a screen reader can follow
it. A snapshot of the styling would fail on every deliberate change and pass on
every broken one.

The visual direction — dense spacing, minimal chrome, one accent — came from a
design-system query for an internal developer console. Its font recommendation
(JetBrains Mono + IBM Plex Sans, from Google Fonts) was not taken: this is served
from a container that has to work on a laptop with no internet, and a webfont that
fails to load is a layout that reflows.
