# Messaging API

RESTful message management built with NestJS, MongoDB, Kafka and Elasticsearch.

**Status: M0 — infrastructure skeleton.** The application boots, the health check
reports on its dependencies, and the three test modes run against a real MongoDB.
There is no message domain yet; see [docs/PLAN.md](docs/PLAN.md) for the milestones
and [docs/back-of-envelope.md](docs/back-of-envelope.md) for the capacity analysis
behind the partitioning decisions.

---

## Requirements

- Node.js 22+
- pnpm 11+ (`corepack enable pnpm`)
- Docker (for MongoDB, Redis, and the test containers)

## Getting started

```bash
pnpm install
cp .env.example .env

# MongoDB (single-node replica set) and Redis.
docker compose up -d mongo redis

# Wait for the replica set to elect a primary — the healthcheck does rs.initiate()
# on first boot, which takes a few seconds.
docker compose ps

pnpm migrate:up      # applies index migrations
pnpm start:dev
```

Then:

- Health check — http://localhost:3000/api/health
- Swagger UI — http://localhost:3000/swagger

MongoDB binds to host port **27018** and Redis to **6380** by default, so this stack
does not collide with other projects already using the standard ports. Override with
`MONGO_HOST_PORT` / `REDIS_HOST_PORT`.

### Why a replica set for a single node

Change streams — the CDC source that will feed Kafka in M2 — are unavailable on a
standalone MongoDB. Running one node as `rs0` is the smallest configuration that
supports them.

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

## Architecture

### Processes

One image, several entrypoints. They share `commonModules` from
[src/app.module.ts](src/app.module.ts) and are deployed as separate services so they
scale independently.

| Entrypoint | Role | Status |
|---|---|---|
| `src/main.ts` | HTTP API | M0 |
| `src/main.consumer.ts` | Kafka consumer → Elasticsearch indexer | M3 |

### Layers

```
routers/      HTTP controllers and DTOs — no business logic
workflows/    application layer: one use case per directory
domain/       aggregates, invariants, domain events        (M1)
cores/        persistence models, mappers, repositories
infra/        database, logging, CLS, caching, kafka, elasticsearch
common/       cross-cutting: base repository, guards, filters, interceptors
```

### Multi-tenancy

`tenantId` is read once from the verified JWT by
[JwtStrategy](src/common/auth-passport/jwt.strategy.ts), pushed into CLS, and read
from there by
[TenantScopedRepository](src/common/tenant-scoped.repository.ts). It is never
accepted from a request body, param or query string.

The consequence is that isolation is a property of the repository rather than a
discipline applied at each call site: a use case cannot leak across tenants by
forgetting a filter clause, and a repository used outside a tenant context throws
rather than silently querying everything. Work that legitimately spans tenants —
consumers, migrations, jobs — states the tenant explicitly via `forTenant(id)`.

### The empty-filter guard

MongoDB drops `undefined` values from a filter, so `{ tenantId: undefined }`
becomes `{}`. A read then returns an arbitrary document — in a multi-tenant system,
someone else's — and `updateMany` / `deleteMany` affect every document in the
collection. Neither raises an error.

[BaseRepository](src/common/base.repository.ts) refuses any call whose conditions
all evaporated, turning a silent breach into a loud failure. `src/common/base.repository.spec.ts`
covers it.

### Indexes

Indexes live in `migrations/` and nowhere else; `autoIndex` is off in every
environment. Building indexes at process start is an unbounded blocking operation
on a large collection, and a schema that declares indexes the database may not
actually have is worse than one that declares none. Tests run the same migrations,
so they exercise the real indexes.

Migrations are plain CommonJS so the same files load unchanged from the CLI and
from inside jest, with no build step in between.

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
| `pnpm start:dev` | HTTP API with watch mode |
| `pnpm start:consumer` | Kafka consumer (M3) |
| `pnpm migrate:up` / `migrate:down` | Apply / roll back index migrations |
| `pnpm migrate:create <name>` | Scaffold a migration |
| `pnpm test` | Unit and integration tests |
| `pnpm lint` | ESLint with `--fix` |

## Documentation

- [docs/PLAN.md](docs/PLAN.md) — decisions, architecture, milestones
- [docs/back-of-envelope.md](docs/back-of-envelope.md) — capacity estimate behind
  the Kafka partitioning trade-off
- `docs/adr/` — architecture decision records (M4)
