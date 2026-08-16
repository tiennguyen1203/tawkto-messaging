# Progress

**Where this is: I6 finished — the demo UI is a messenger, and messaging grew the
conversation list it needed. Every milestone in the plan is done.**

The one place that says what is done. [PLAN.md](docs/PLAN.md) says what each part is
and why it is shaped that way; this says whether it happened and what proved it.

**Done means verified, not written.** Every row below names the check that settled
it, because a milestone marked done on the strength of a green unit test has been
wrong here more than once — real data on the topic, a real container and a real
cluster each found something the suite could not.

## Milestones

| | What | Status | What settled it |
|---|---|---|---|
| M0 | Template ported to MongoDB — tenant-scoped repositories, stateless JWT, CLS, logging, health check, three-mode test harness | done | App boots, health 200, three sample specs proving all three harness modes survived the port |
| M1 | Conversations and messages — cursor pagination, index migrations, authorisation | done | Full read/write path green, and usable without Kafka or Elasticsearch |
| M2 | Kafka in KRaft mode, Debezium connector, the SMT chain | done | A real event captured off the topic: right name, right key, right encoding — recorded verbatim in PLAN §6 |
| M3 | The Elasticsearch index schema | done | Template applied to a wiped cluster, re-applied unchanged, and an unmapped field rejected 400 |
| M3.1 | Bulk writes behind per-tenant aliases | done | Two tenants with identical text, each visible only through its own alias; four mutations each killed exactly one test |
| M3.2 | The CDC consumer, extended to the whole change stream | done | Create, edit and delete each reached Elasticsearch through compose; offsets reset twice and the index settled on the same documents both times |
| M3.3 | `search_after` queries and the search endpoint | done | A term posted through the API found in ~2s; another tenant's identical text answered 404; paging at `limit=1` walked every hit exactly once |
| M3.4 | `lastMessageAt` | **dropped** | Nothing reads it — see PLAN §6. The field was removed rather than left in the model |
| M4 | README for a cold reader, seven ADRs, a glossary per context | done | Every ADR the code cites exists; every internal link resolves; every command the README gives exists in `package.json` |
| — | Contexts split into `shared/` + `messaging/` + `identity/`, boundary enforced by lint | done | A deliberate cross-context import fails `pnpm lint` with a message naming the fix |
| I1 | Identity — tenants, users, token issuance, its own process | done | A token issued by identity accepted by messaging end to end; `APP_ENV=prod` answered 403 on every seeding route |
| I2 | `tenant-created` event — identity publishes, messaging provisions the alias | done | The alias appeared ~2s after the tenant, with the right filter, **with no message ever sent** |
| I3 | The demo UI shell — Vue, Vite, a typed API client, no features | done | The `demo-ui` container answering **`Content-Type: application/json`** on both proxied APIs — the check a 200 alone had passed while the app was broken. `POST` through the proxy returned 201; `/api/*` proved to reach messaging, not identity, by a route only messaging has; identity now 404s at `/` |
| I4 | The picker — choose a tenant and a user, receive a token | done | A real Chromium driving the container through the whole flow: create a tenant, create a user, take a token, reload and watch it go. Twelve screenshots, each taken where a test had just asserted something — [docs/ui-review/index.html](docs/ui-review/index.html) |
| I5 | The messaging pane — post, page, search, and the isolation probes | done | A browser posting seven messages, walking two cursor pages, finding two of them by keyword, and being refused 404 then 403. The probe found a real authorisation hole (below) |
| I6 | The UI rebuilt as a messenger — chat rail, thread, identity switcher — and `GET /conversations` behind it | done | A browser signing in from the header, chatting, paging, searching, then becoming the other person and reading the same thread. The index it needs is proved used: `IXSCAN`, no in-memory sort |

### The hole the demo found

Both read paths — list and search — checked which **tenant** the conversation
belonged to and stopped there. Membership was checked only when writing. Any token
for a tenant could therefore read, or search, any conversation in that tenant by id.
Reproduced with curl, fixed in both use cases, and covered by three tests; removing
either check kills exactly the tests that name it.

It had existed since M1 and no test noticed, because every read test held a
participant's token. The scenario that found it was built to *demonstrate*
authorisation, not to look for a bug in it.

### What the browser found that the unit tests could not

Three defects, none visible in a green suite: the shell was missing its `Picker`
link because a search-and-replace had silently not matched; a lone button stretched
across a whole card, because `BaseCard` is a grid and a grid stretches its children;
and the two "light and dark" screenshots were byte-identical, because Playwright
already defaults to light and the dark one was never taken. Looking at the pictures
is the check. Running the tests is not the same thing.

### Why I3 was marked done once already, wrongly

Identity served the built client first, and the check was "`/` returns 200 and the
asset bundle loads". Both were true. The app was still broken: it asks for
`/identity-api/...`, identity has no such prefix and nothing to strip one with, so
every API call came back as `index.html` under a **200**. A status code was mistaken
for an answer. The container that replaced it is nginx, which serves the assets and
strips the prefix exactly as the dev server does — and the check is now the content
type, not the status.

## Open, and deliberately so

| | Where it is written down |
|---|---|
| No endpoint lists conversations | PLAN §6 (M3.4) — it is why `lastMessageAt` was dropped |
| Screenshots are committed under `docs/ui-review/` on purpose — the review page is the artefact | this file |
| The `demo-ui` proxy is not a gateway — no auth, no rate limiting; it routes two prefixes so the browser stays same-origin | PLAN §10b |
| The Debezium connector's collection name is a literal that must match `MESSAGES_COLLECTION` | architecture.md, Known gaps |
| Provisioning scripts run from the host, not from the image | README, Getting started |

## Keeping this honest

Update the row in the same change that finishes the work — not afterwards, when the
detail that made it convincing has already been forgotten.

Status lives here and nowhere else. [architecture.md](docs/architecture.md) colours
its diagram by whether a *component* does work in the running system, which is a
different question and answers it in the picture rather than in a table.
