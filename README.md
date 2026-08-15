# Messaging API

RESTful message management built with NestJS, MongoDB, Kafka and Elasticsearch.

**Status: M3 — the search index exists; nothing writes to it yet.** Conversations
and messages can be created and listed with cursor pagination, scoped to a tenant by
the repository rather than by its callers; every insert reaches Kafka through Debezium
without the application dual-writing. Elasticsearch now has its mapping, applied as a
deploy step — but the consumer that fills it (M3.2) and the search endpoint (M3.3) are
not built. See [docs/PLAN.md](docs/PLAN.md) for the milestones,
[docs/architecture.md](docs/architecture.md) for what is wired to what, and
[docs/back-of-envelope.md](docs/back-of-envelope.md) for the capacity analysis behind
the partitioning decisions.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/conversations` | Creator is added to the participants automatically |
| `POST` | `/api/v1/messages` | Sender comes from the token; timestamp from the server |
| `GET` | `/api/v1/conversations/:conversationId/messages` | Cursor paginated, newest first |
| `GET` | `/api/v1/conversations/:conversationId/messages/search?q=` | M3.3 |
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

pnpm migrate:up              # creates the MongoDB indexes
pnpm es:apply-templates      # creates the Elasticsearch index and its mapping
pnpm debezium:register       # installs the CDC connector
pnpm start:dev
```

The two provisioning steps are separate commands rather than boot-time work for the
same reason: replicas would race each other, and a mapping or an index that fails to
apply should stop a deploy rather than a request. Both are idempotent.

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
POST /messages ─► mongo (one insert) ─► oplog ─► Debezium ─► messaging.message-created.v1
                                                              6 partitions, key = conversationId
```

Keying by `conversationId` puts all of a conversation's messages on one partition,
so a single consumer processes them in order. Watch the stream with:

```bash
docker exec techbank-interview-2-kafka-1 kafka-console-consumer \
  --bootstrap-server kafka:9092 --topic messaging.message-created.v1 \
  --from-beginning --property print.key=true --property print.partition=true
```

The event is the stored document, flattened — ids arrive as hex strings and dates
as epoch milliseconds. The document keeps Mongo's own field
names, `_id` included: the only consumer is our indexer, inside the same bounded
context, so a cosmetic rename would buy nothing. `_id` is kept out of the *API*
by the response DTOs instead. A sample record is recorded in
[docs/PLAN.md](docs/PLAN.md); M3.2 captures a fresh one as a fixture so the consumer
specs can run without standing Kafka Connect up inside jest.

### Processes

One image, several entrypoints. They share `commonModules` from
[src/app.module.ts](src/app.module.ts) and are deployed as separate services so they
scale independently.

| Entrypoint | Role | Status |
|---|---|---|
| `src/main.ts` | HTTP API | M1 |
| `src/main.consumer.ts` | Kafka consumer → Elasticsearch indexer | M3.2 |
| *(Kafka Connect)* | Debezium MongoDB connector — infrastructure, not our code | M2 |

### Layers

```
routers/      HTTP controllers and DTOs — no business logic
workflows/    use cases — one per directory; business rules live here
cores/        persistence models, repositories
infra/        database, logging, CLS, caching — Elasticsearch joins in M3.1
common/       cross-cutting: base repository, guards, filters, interceptors
```

### Multi-tenancy

`tenantId` is read once from the verified JWT by
[JwtStrategy](src/common/auth-passport/jwt.strategy.ts), pushed into CLS, and read
from there by
[TenantScopedRepository](src/common/tenant-scoped.repository.ts). It is never
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

[BaseRepository](src/common/base.repository.ts) refuses any call whose conditions
all evaporated, turning a silent breach into a loud failure.
[base.repository.spec.ts](src/common/base.repository.spec.ts) covers it.

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
pnpm test          # unit + integration, against a real MongoDB in testcontainers
pnpm test:cov
pnpm lint
pnpm exec tsc --noEmit -p tsconfig.json
```

Integration tests start one MongoDB container for the whole run and give each test
file its own database inside it, so files stay isolated and can run in parallel.
No local MongoDB is required — Docker is.

## Testing utilities

Three modes, chosen automatically by [TestHelper](src/test/test-helper.ts):

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
| `pnpm start:consumer` | Kafka consumer (M3.2) |
| `pnpm migrate:up` / `migrate:down` | Apply / roll back MongoDB index migrations |
| `pnpm es:apply-templates` | Apply the Elasticsearch mapping and create the index (idempotent) |
| `pnpm migrate:create <name>` | Scaffold a migration |
| `pnpm debezium:register` | Install or update the CDC connector (idempotent) |
| `pnpm debezium:status` | Connector and task state |
| `pnpm test` | Unit and integration tests |
| `pnpm typecheck` | Typecheck the app and the scripts |
| `pnpm lint` | ESLint with `--fix` |

## Documentation

- [docs/architecture.md](docs/architecture.md) — component map, what is built and
  what is not, known gaps
- [docs/PLAN.md](docs/PLAN.md) — decisions, architecture, milestones
- [docs/back-of-envelope.md](docs/back-of-envelope.md) — capacity estimate behind
  the Kafka partitioning trade-off
- [docs/testing-conventions.md](docs/testing-conventions.md) — the when/should
  naming pattern, what is tested at which layer, and how load-bearing tests are
  proven non-vacuous
- `docs/adr/` — architecture decision records (M4)
