# Messaging API

RESTful message management built with NestJS, MongoDB, Kafka and Elasticsearch.

A message is written once, to MongoDB. Debezium carries the change to Kafka, a
consumer projects it into Elasticsearch, and search reads it back — scoped to a
tenant by the repository rather than by its callers, at every step.

Status: [PROGRESS.md](PROGRESS.md) · wiring: [architecture](docs/architecture.md) ·
decisions: [ADRs](docs/adr/) · log: [PLAN](docs/PLAN.md) · what is missing on purpose:
[below](#what-is-deliberately-not-here).

## Run it

```bash
corepack enable pnpm   # once
pnpm install           # ~10s
pnpm stack:up          # ~5 min first time (2 GB of Docker images), ~80s after
```

Open **http://localhost:8088**, use the switcher in the top right to make a tenant
and two people, and start a chat.

| | |
|---|---|
| Demo UI | http://localhost:8088 |
| Messaging API | http://localhost:3000 · [Swagger](http://localhost:3000/swagger) |
| Identity API | http://localhost:3001 |
| Elasticsearch UI | http://localhost:8089 — indices, documents, raw queries |
| MongoDB | `mongodb://localhost:27018/messaging?directConnection=true` |
| Elasticsearch | http://localhost:9200 |
| Kafka | `localhost:9094` · Connect on http://localhost:8083 |

**`directConnection=true` is not optional** for Compass or any driver on the host.
Mongo runs as a one-node replica set, so without it the client discovers the member
by its in-network name and fails with `getaddrinfo ENOTFOUND mongo`.

`stack:up` brings up infrastructure, migrations, the search index, the Kafka topics,
the CDC connector and the app containers, in that order. It is idempotent — re-run it
to recover from a half-finished start. `pnpm stack:down` stops it, keeping the data.

Needs Node 22+, pnpm 11+, and Docker with ~5 GB free and 4 GB of memory.

### Doing it by hand

What `stack:up` runs, if you need to do one step at a time:

```bash
cp .env.example .env
docker compose up -d mongo redis kafka kafka-connect elasticsearch
docker compose ps                                    # wait for all five: healthy
docker compose --profile migrate run --rm migrate    # indexes, change-stream pre-images
pnpm es:apply-templates                              # index + mapping
pnpm kafka:create-topics                             # both topics
pnpm debezium:register                               # the CDC connector
docker compose --profile app up -d --build           # API, indexer, identity, UI
```

From source instead of containers, while changing it:

```bash
pnpm start:dev         # API, watch mode
pnpm start:consumer    # indexer
pnpm start:identity    # identity
pnpm ui:dev            # client on :5173, proxying to both
```

- Provisioning is separate from boot on purpose: replicas would race, and a failed
  index or topic should stop a deploy rather than a request. All idempotent.
- The TypeScript tools run from the host — the production image ships runtime
  dependencies only. `migrate` is the exception and has its own compose service.
- `KAFKA_BROKERS` is **9094**, the listener published to the host. `9092` is internal
  and unreachable from a consumer started with pnpm.
- Ports are off the defaults so nothing collides: Mongo **27018**, Redis **6380**, UI
  **8088**. Override with `MONGO_HOST_PORT`, `REDIS_HOST_PORT`, `DEMO_UI_PORT`.

### Why a replica set for a single node

Change streams — the source Debezium tails — are unavailable on a standalone
MongoDB. Running one node as `rs0` is the smallest configuration that supports
them.

## Architecture

A component map — what is built, what is scaffolded, what is still a plan — is in
[docs/architecture.md](docs/architecture.md).

### Change data capture instead of dual writes

`POST /api/v1/messages` performs exactly one write, to MongoDB. Nothing publishes
to Kafka on the request path. Debezium tails the oplog and produces the event, so
there is no window in which the message is stored but the event is lost — the
failure a dual write cannot avoid. See ADR-002 for what this costs.

```
POST /messages ─► mongo (one insert) ─► oplog ─► Debezium ─► messaging.message-changed.v1
                                                              6 partitions, key = conversationId
```

Keying by `conversationId` puts all of a conversation's messages on one partition,
so a single consumer processes them in order. Watch the stream with:

```bash
docker exec techbank-interview-2-kafka-1 kafka-console-consumer \
  --bootstrap-server kafka:9092 --topic messaging.message-changed.v1 \
  --from-beginning --property print.key=true --property print.partition=true
```

The event is the stored document, flattened — ids arrive as hex strings and dates
as epoch milliseconds. The document keeps Mongo's own field
names, `_id` included: the only consumer is our indexer, inside the same bounded
context, so a cosmetic rename would buy nothing. `_id` is kept out of the *API*
by the response DTOs instead. A sample record is recorded in
[docs/PLAN.md](docs/PLAN.md).

The topic is named `changed`, not `created`, because it carries the whole change
stream: a create, an edit and a deletion all travel over it, keyed by conversation so
one message's history stays on one partition and in order. The consumer turns each
event into one Elasticsearch operation in that same order — writes replace the
document whole, deletions remove it.

### Processes

One image, several entrypoints. They share `commonModules` from
[src/messaging/app.module.ts](src/messaging/app.module.ts) and are deployed as separate services so they
scale independently.

| Entrypoint | Compose service | Role |
|---|---|---|
| `src/messaging/main.ts` | `messaging-api` | HTTP API |
| `src/messaging/main.consumer.ts` | `messaging-consumer` | Kafka → Elasticsearch indexer |
| `src/identity/main.ts` | `identity-api` | Tenants, users and the tokens that carry them |
| `migrate-mongo` | `migrate` | One-shot migration runner |
| *(Kafka Connect)* | `kafka-connect` | Debezium connector — infrastructure, not our code |

All of ours are **one image with a different command**, not several Dockerfiles —
the image has no default, so a container that names no command prints the choices and
exits rather than silently starting the wrong one.

### Layers

```
messaging/            the bounded context — everything about conversations and messages
  routers/            HTTP controllers and DTOs — no business logic
  workflows/          use cases — one per directory; business rules live here
  cores/              persistence models, repositories
  consumers/          the Kafka → Elasticsearch indexer

common/               shared kernel: base repository and model, base use case,
                      guards, filters, interceptors, route config
infra/                shared kernel: database, logging, CLS, caching, elasticsearch
health-check/         process-level liveness, owned by no context

app.module.ts         composition roots — above every context, and the only place
consumer.module.ts    allowed to wire them together
```

A context may use the shared kernel; it may not reach into another context. That is
a lint rule, not a convention — `pnpm lint` fails on a crossing import and says what
to do instead. See [ADR-007](docs/adr/007-contexts-in-one-deployable.md).

### Multi-tenancy

`tenantId` is read once from the verified JWT by
[JwtStrategy](src/shared/auth-passport/jwt.strategy.ts), pushed into CLS, and read
from there by
[TenantScopedRepository](src/shared/tenant-scoped.repository.ts). It is never
accepted from a request body, param or query string.

Every inherited method that takes a filter is overridden to apply it, and writes
stamp `tenantId` rather than accept one — `Omit<Partial<T>, 'tenantId'>` makes
supplying it a compile error. So isolation is a property of the repository rather
than a discipline applied at each call site: a use case cannot leak across tenants
by forgetting a clause, and a repository used with no tenant in scope throws
instead of quietly querying everything.

Two named doors lead out, and only two:

| | For |
|---|---|
| `forTenant(id)` | Consumers, jobs and migrations that run outside a request and so have no CLS context |
| `acrossTenants()` | Deliberately global work — a platform-admin report, a backfill across tenants |

Both are visible at the call site, which is the point: a cross-tenant query should
be impossible to write by accident and trivial to grep for on purpose. The
authority to use `acrossTenants()` is the use case's to check — the repository
knows nothing about roles.

### The empty-filter guard

MongoDB drops `undefined` values from a filter, so `{ tenantId: undefined }`
becomes `{}`. A read then returns an arbitrary document — in a multi-tenant system,
someone else's — and `updateMany` / `deleteMany` affect every document in the
collection. Neither raises an error.

[BaseRepository](src/shared/base.repository.ts) refuses any call whose conditions
all evaporated, turning a silent breach into a loud failure.
[base.repository.spec.ts](src/shared/base.repository.spec.ts) covers it.

### Indexes

Indexes live in `migrations/` and nowhere else; `autoIndex` is off in every
environment. Building indexes at process start is an unbounded blocking operation
on a large collection, and a schema that declares indexes the database may not
actually have is worse than one that declares none. Tests run the same migrations,
so they exercise the real indexes.

Migrations are plain CommonJS so the same files load unchanged from the CLI and
from inside jest, with no build step in between.

## Testing

```bash
pnpm test          # unit + integration, against a real MongoDB and Elasticsearch
pnpm test:cov
pnpm lint
pnpm exec tsc --noEmit -p tsconfig.json
```

Integration tests start one MongoDB container and one Elasticsearch container for
the whole run, concurrently — Elasticsearch is a JVM and costs far more to start, so
the run pays the slower of the two rather than the sum. Each test file gets its own
database inside the MongoDB container, so files stay isolated and can run in
parallel. Elasticsearch specs share the one index and empty it between tests.

No local MongoDB or Elasticsearch is required — Docker is. The Elasticsearch specs
apply the same mapping file `pnpm es:apply-templates` uses, so a mapping mistake
fails the suite rather than surviving to production.

## Testing utilities

Three modes, chosen automatically by [TestHelper](src/shared/test/test-helper.ts):

```ts
// Use case or repository — scans the dependency tree, exposes only what is needed
const testHelper = TestHelper.lightweightMode(MyUseCase);

// Controller — minimal Nest app with the real guard chain, filter and interceptor
const testHelper = TestHelper.lightweightMode(MyController).imports(SomeModule);

// Whole AppModule — catches wiring mistakes the lightweight modes cannot see
const testHelper = TestHelper.fullAppMode();
```

The scanner reads constructor metadata and therefore only sees class tokens. That
is why repositories take the mongoose `Connection` rather than `@InjectModel(...)`,
which resolves through a string token the scanner cannot follow.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm stack:up` | Everything: infrastructure, provisioning, then the three app containers. Idempotent |
| `pnpm stack:down` | Stops it all, keeping the volumes |
| `pnpm build` | Compile with `tsc` (not the Nest CLI — see D26 in the plan) |
| `pnpm start:dev` | HTTP API with watch mode |
| `pnpm start:consumer` | Kafka → Elasticsearch indexer |
| `pnpm migrate:up` / `migrate:down` | Apply / roll back MongoDB migrations |
| `pnpm kafka:create-topics` | Create the topics with the right partition count (idempotent) |
| `pnpm es:apply-templates` | Apply the Elasticsearch mapping and create the index (idempotent) |
| `pnpm migrate:create <name>` | Scaffold a migration |
| `pnpm debezium:register` | Install or update the CDC connector (idempotent) |
| `pnpm debezium:status` | Connector and task state |
| `pnpm test` | Unit and integration tests |
| `pnpm typecheck` | Typecheck the app and the scripts |
| `pnpm lint` | ESLint with `--fix` |
| `pnpm ui:install` | Install the demo UI, which has its own lockfile |
| `pnpm ui:dev` | Vite dev server for the demo UI, proxying to both APIs |
| `pnpm ui:build` | Build the demo UI into `ui/dist`, where identity serves it |
| `pnpm ui:test` | The demo UI's unit tests |
| `pnpm ui:e2e` | Playwright against the running `demo-ui` container, writing screenshots |
| `pnpm ui:review` | Builds [docs/ui-review/index.html](docs/ui-review/index.html) from those screenshots |

## Documentation

Roughly in the order a newcomer needs them.

| | |
|---|---|
| [PROGRESS.md](PROGRESS.md) | What is done, what is next, and the check that settled each one |
| [CONTEXT-MAP.md](CONTEXT-MAP.md) | The two bounded contexts, how they relate, and a glossary for each |
| [docs/architecture.md](docs/architecture.md) | Component map: what is built, what is not, and the known gaps |
| [docs/adr/](docs/adr/) | Seven decision records, each with the trade-off it accepted |
| [docs/PLAN.md](docs/PLAN.md) | The running log — every decision D1–D38, the milestones, what was verified on a running stack |
| [docs/back-of-envelope.md](docs/back-of-envelope.md) | The capacity estimate behind the Kafka partitioning trade-off |
| [docs/testing-conventions.md](docs/testing-conventions.md) | The when/should naming pattern, what is tested at which layer, and how load-bearing tests are proven non-vacuous |

If you read only one after this file, read [CONTEXT-MAP.md](CONTEXT-MAP.md). If you read
only one decision record, read
[ADR-002](docs/adr/002-cdc-not-outbox.md) — change data capture instead of a
transactional outbox is the choice the rest of the system hangs off.

## What is deliberately not here

Stated because their absence is a decision, not an oversight.

- **No endpoint lists conversations.** They can be created and posted into, not
  enumerated — which is why there is no `lastMessageAt` on the model: it would have
  been maintained for no reader.
- **No tenant provisioning.** A tenant exists because a verified token says so. Per-tenant
  Elasticsearch aliases are consequently created on first write, which is the wrong
  place for them; [PLAN.md §10](docs/PLAN.md) records why and what it would take to move them.
- **No `lastMessageAt`, no unread counts, no read receipts, no attachments.**

---

## Endpoints

### Messaging — `localhost:3000`

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/conversations` | Creator is added to the participants automatically |
| `GET` | `/api/v1/conversations` | The caller's own conversations, newest first, cursor paginated |
| `POST` | `/api/v1/messages` | Sender comes from the token; timestamp from the server |
| `GET` | `/api/v1/conversations/:conversationId/messages` | Cursor paginated, newest first |
| `GET` | `/api/v1/conversations/:conversationId/messages/search?q=` | Full-text, cursor paginated, scored |
| `GET` | `/api/health` | Public |

### Identity — `localhost:3001`

Seeding for a local demonstration. `for-demo` is in the path because these
endpoints hand out a token to whoever names a user, without checking anything —
and `ForDemoOnlyGuard` refuses all of them outside a local environment.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/for-demo/tenants` | Creates a tenant, and publishes the event that provisions its search alias |
| `GET` | `/api/v1/for-demo/tenants` | Every tenant — the only route that enumerates them, and the first the picker calls |
| `POST` | `/api/v1/for-demo/users` | Creates a user inside one |
| `GET` | `/api/v1/for-demo/users?tenantId=` | Lists a tenant's users — what the picker UI will read |
| `POST` | `/api/v1/for-demo/tokens` | Issues a token for a user id. No credential is checked |
| `GET` | `/api/health` | Public |

Another tenant's conversation answers **404**, never 403 — a 403 would confirm it
exists. A conversation in your own tenant that you are not a participant of answers
**403**, on reading and on writing alike.

That last clause used to be true only of writing. Reading checked the tenant and
stopped there, so any token for a tenant could read any conversation in it by id —
found by pointing a browser at the Isolation panel of the demo UI, fixed in both read
paths, and now covered by three tests that a mutation each kills.

---

## The demo UI

A Vue 3 client in [ui/](ui/), shaped like a messenger: chats on the left, the
conversation on the right, and an identity switcher in the top right. Switching
between two people is the most repeated action in a multi-tenant demo, so it is one
click rather than a page of its own.

**What it looks like, and what was checked:**
[docs/ui-review/index.html](docs/ui-review/index.html) — screenshots taken by a real
browser driving the container, split into
[the messenger](docs/ui-review/messenger.html) and
[what the API refuses](docs/ui-review/refusals.html). Each is taken at a point a test
had just asserted something about, including the states nobody clicks through by
hand.

`pnpm stack:up` serves it from nginx at **:8088**. While changing it, `pnpm ui:dev`
runs Vite on :5173 instead; both proxy `/identity-api` to 3001 and `/api` to 3000, so
the browser makes same-origin calls and neither service needs a CORS policy (PLAN
§10b). The two proxy configs have to be changed together.

It builds from [ui/Dockerfile](ui/Dockerfile), with `ui/` as its whole build context
— the client shares no stage with the server's image. `pnpm ui:build` is for working
locally, not a prerequisite. Port **8088** rather than 8080, which is contested enough that a page
from another project answering instead is a real possibility.

Identity served the UI first, and that was wrong in a way worth recording: the client
asks for `/identity-api/...`, identity has no such prefix and nothing to strip one
with, so the page loaded and every call it made came back as `index.html` under a
200. Serving static files and proxying an API are one job, and nginx does both.

`ui/` is a separate package on purpose: it is outside the pnpm workspace, has its
own lockfile and tsconfig, and is excluded from the server's TypeScript projects.
A Vue toolchain and a NestJS one disagree about `module`, `lib` and `types`, and
sharing one config makes both worse.

The proxy is deliberately the only thing in front of the APIs. It is not a gateway:
no authentication, no rate limiting, no request shaping — it routes two prefixes so
the browser stays on one origin. See PLAN §10b for when a real one would earn its
keep.
