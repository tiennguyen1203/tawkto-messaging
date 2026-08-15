# Messaging API

RESTful message management built with NestJS, MongoDB, Kafka and Elasticsearch.

A message is written once, to MongoDB. Debezium carries the change to Kafka, a
consumer projects it into Elasticsearch, and search reads it back — scoped to a
tenant by the repository rather than by its callers, at every step.

**Where this has got to, and what proved each step, is in
[PROGRESS.md](PROGRESS.md)** — one file claims status, so there is one file to
correct when it changes. What is deliberately absent is listed
[below](#what-is-deliberately-not-here).
See [docs/architecture.md](docs/architecture.md) for what is wired to what,
[docs/adr/](docs/adr/) for the decisions and the trade-offs each accepted, and
[docs/PLAN.md](docs/PLAN.md) for the running log.

## Endpoints

### Messaging — `localhost:3000`

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/conversations` | Creator is added to the participants automatically |
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
| `POST` | `/api/v1/for-demo/users` | Creates a user inside one |
| `GET` | `/api/v1/for-demo/users?tenantId=` | Lists a tenant's users — what the picker UI will read |
| `POST` | `/api/v1/for-demo/tokens` | Issues a token for a user id. No credential is checked |
| `GET` | `/api/health` | Public |

Another tenant's conversation answers **404**, never 403 — a 403 would confirm it
exists. A known conversation with a non-participant sender answers **403**.

---

## Requirements

- Node.js 22+
- pnpm 11+ (`corepack enable pnpm`)
- Docker (for MongoDB, Redis, and the test containers)

## Getting started

```bash
pnpm install
cp .env.example .env

# MongoDB (single-node replica set), Redis, Kafka, Debezium and Elasticsearch.
# Kafka Connect is a JVM and takes ~60s to report healthy.
docker compose up -d mongo redis kafka kafka-connect elasticsearch
docker compose ps            # wait for all five to be healthy

pnpm migrate:up              # MongoDB indexes and change stream pre-images
pnpm es:apply-templates      # the Elasticsearch index, its mapping, and the
                             # cluster's refusal to auto-create messages-* indices
pnpm kafka:create-topics     # both topics, with the partition counts they need
pnpm debezium:register       # the CDC connector

pnpm start:dev               # the API
pnpm start:consumer          # the indexer, in a second terminal
```

Or run the services themselves in containers, from the same image:

```bash
docker compose --profile app up -d messaging-api messaging-consumer identity-api
```

The provisioning steps above still run from the host — they are TypeScript tools and
the production image ships runtime dependencies only. `migrate` is the exception and
has its own compose service, because `migrate-mongo` is a runtime dependency:

```bash
docker compose --profile migrate run --rm migrate
```

The provisioning steps are separate commands rather than boot-time work for the same
reason: replicas would race each other, and a mapping, an index or a topic that fails
to apply should stop a deploy rather than a request. All are idempotent.

`KAFKA_BROKERS` points at **9094**, the listener compose publishes to the host. `9092`
is the internal one, reachable only from another container — a consumer started with
pnpm cannot use it.

Then:

- Health check — http://localhost:3000/api/health
- Swagger UI — http://localhost:3000/swagger

MongoDB binds to host port **27018** and Redis to **6380** by default, so this stack
does not collide with other projects already using the standard ports. Override with
`MONGO_HOST_PORT` / `REDIS_HOST_PORT`.

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
