# Implementation Plan — Messaging API

Plan for building the message management service for the Senior Engineer Code Test, by
porting the `Aentry-v3-api` template and replacing its entire persistence layer.

---

## 1. What the test asks for

| Area | Requirement |
|---|---|
| Stack | NestJS · MongoDB (primary store) · Kafka (broker) · Elasticsearch (search) |
| Endpoints | `POST /api/messages` · `GET /api/conversations/:id/messages` · `GET /api/conversations/:id/messages/search?q=` |
| Architecture | DDD · Event-Driven Architecture · Multi-tenancy |
| Quality | SOLID · unit + integration tests · README documenting architecture decisions |
| NFR | Proper Mongo indexes · proper ES mappings · **message delivery guarantees** · input validation/sanitization · basic authn/authz · caching (optional) |

The `Message` type given in the brief:

```ts
type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
};
```

We add `tenantId` (required for multi-tenancy).

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Multi-entrypoint, single `src/`** — no Nest monorepo mode | The template already uses this pattern (`cron-runners`). Monorepo mode costs ~1h of config work; migrating *into* a monorepo later is cheap |
| D2 | **`@nestjs/mongoose` + typegoose's `buildSchema()`** | Native DI, `MongooseHealthIndicator` available out of the box, no dependency on `nestjs-typegoose` (unmaintained) |
| D3 | **Repositories take `Connection` (a class token)**, not `@InjectModel` | `scan-dependencies.ts` cannot resolve string tokens — lightweight test mode would break. Maps 1-to-1 onto the old `dataSource.createEntityManager()` |
| D4 | **MongoDB as a single-node replica set** | Required for the oplog / change streams that CDC depends on |
| D5 | **Drop `typeorm-transactional`**, no replacement | With CDC the write path is a single insert — no transaction needed |
| D6 | **Keep the passport JWT skeleton, drop the DB session lookup.** Payload `{ sub, tenantId, roles }` | `tenantId` flows into CLS so every repository scopes itself. Answers "authn + authz" and "multi-tenancy" with one mechanism |
| D7 | **Port the empty-filter guard from `BaseRepository` as-is** | Mongo is more dangerous than TypeORM here: `updateMany({tenantId: undefined})` rewrites the whole collection — a cross-tenant data breach |
| D8 | **Indexes live in migrations (`migrate-mongo`), `autoIndex: false`** | Building indexes at runtime is a production hazard. Migrations are the single source of truth |
| D9 | **No `@index()` decorators on models** | Declaring in two places invites drift. Models carry a comment pointing at the owning migration |
| D10 | **Migrations do not auto-run on boot** | Multiple processes would race; index builds can block. `yarn migrate:up` is a separate deploy step |
| D11 | **CDC via Debezium** instead of a transactional outbox | Only one write happens, so there is no dual-write gap. Removes the outbox collection, the transaction, and the relay process |
| D12 | **Topic key = `conversationId`** via an SMT chain (not `_id`, not `tenantId:conversationId`) | Kafka only orders within a partition, and `partition = hash(key) % n`. A key unique per record (`_id`) scatters a conversation across partitions and gives up ordering entirely. `conversationId` groups a conversation onto one partition, so one consumer processes it sequentially. Adding `tenantId` would not improve distribution (ObjectIds are already globally unique), complicates the SMT, and worsens hot-partition risk. Not strictly required by today's consumer, but it is the right answer to the graded item and re-keying a live topic later is expensive. Producer must run with `enable.idempotence=true` or retries can still reorder |
| D21 | **Accept the hot-partition risk that comes with D12** — no bucket-sharding, no fallback keying | Quantified in [back-of-envelope.md](./back-of-envelope.md): with the bulk consumer of D22, one conversation saturates its partition at roughly **400,000 users typing continuously at once**, and Kafka itself only at ~600,000. Ordinary messaging never approaches this; only live-stream chat does, and that is a different product. Mitigations (bucketed composite key, dedicated topic for hot conversations) are documented in ADR-002b but deliberately not built — they would trade away per-conversation ordering to solve a problem this workload does not have |
| D23 | **pnpm rather than yarn** | Faster installs. Its stricter resolution also surfaced three type dependencies the hoisted layout was masking. `node-linker=hoisted` is set in `.npmrc` because typegoose and @suites both assume a flat tree |
| D25 | **TypeScript 6.0.3** — the newest release the toolchain actually supports | 7.x is the Go rewrite and does not expose the JavaScript compiler API ts-jest needs: it fails at `globalSetup`, taking all 71 tests with it. It also sits outside typescript-eslint's peer range (`<6.1.0`). 6.0.3 is inside both peer ranges and passes typecheck, build, lint and the full suite. Adopting it required three config changes TypeScript 6 makes mandatory: `baseUrl` removed in favour of relative `paths`, `types` named explicitly (auto-discovery of `@types/*` is gone), and `rootDir` stated rather than inferred (TS5011). Verified empirically, not assumed |
| D32 | ~~Rename `_id` to `id` before publishing~~ — **reverted** | The connector briefly carried a `ReplaceField$Value` transform so the wire shape never spelled the primary key Mongo's way. Reverted: the topic has exactly one consumer, our own indexer, inside the bounded context that D13 already accepted coupling within. Renaming one field while `__deleted`, epoch-millisecond dates and the rest of the document stay in Mongo's shape is a half-measure that buys nothing and adds an SMT to get wrong. `_id` never reaching an *API* boundary still holds — that is enforced by the DTOs, which is where it belongs. If a consumer outside this context ever subscribes, the answer is a second curated topic, not a cosmetic rename on this one |
| D33 | **Operational scripts are TypeScript, run through ts-node** | Bash was unreadable and, more usefully, could not import from `src`. The register script now injects `KafkaTopic.MessageCreated` and `MESSAGE_CREATED_PARTITIONS` into the connector config at registration time — the two keys are absent from the JSON, so the topic name has one source of truth and the producer cannot drift from the consumer. That removes the duplication a deleted config test had been pointlessly guarding. Scripts sit outside the app's `rootDir`, so they get their own `tsconfig.scripts.json`, listed in `pnpm typecheck` and in eslint's project list |
| D30 | **Collection names are pinned on the model, not derived from the class name** | Typegoose pluralises the class, so `MessageModel` became `messagemodels` while the migration indexed `messages`. The application ran full collection scans and nothing complained — and `migrations.spec.ts` passed *vacuously*, because it explained a query against the hardcoded `messages`, an empty collection that did have the index. IXSCAN on an empty collection is still IXSCAN. The spec now derives the name from `repository.collectionName`, so an assertion can never again be aimed at a collection the application does not use. Found by M2: Debezium was watching `messaging.messages` and no event ever arrived |
| D31 | **`migrate-mongo-config.js` loads `.env` and refuses to default the connection string** | The CLI does not load `.env`, so `MONGO_URI` was undefined and the config silently fell back to `mongodb://localhost:27017/messaging` — an unrelated MongoDB that happened to be listening on the developer's machine. `pnpm migrate:up` created a database and an index inside another project's data store, and reported success. Tests never caught it because the harness sets `MONGO_URI` programmatically; only the CLI path was broken. There is now no default at all: a missing `MONGO_URI` throws with an explanation, because guessing which database to migrate is never the safe choice |
| D29 | **A conversation needs at least two distinct participants** | Two very different requests used to produce identical results: `participantIds: []` (a client that forgot to fill the list) and `participantIds: ['alice']` (a deliberate note-to-self) both answered 201 with a conversation containing only the caller. The API could not tell a bug from an intention. The rule cannot live in the DTO, because the creator is merged in and duplicates collapsed afterwards — the use case is the first point where membership is final, which is also what turns a previously dead guard into a reachable one: its old test passed `creatorId: ''`, a state `JwtStrategy` makes impossible. So the DTO now rejects an empty array (`@ArrayMinSize(1)`, a 400 naming the field) and the use case rejects a final membership below `MIN_CONVERSATION_PARTICIPANTS`. Note-to-self is a real feature in other products; supporting it is a one-line change to that constant, and doing it deliberately beats arriving at it by accident |
| D28 | **`TenantScopedRepository` overrides every filter-taking method; two named doors lead out** | Only reads were confined originally, via a `protected scoped()` helper each repository method had to remember to call — and `createOne`, `updateMany`, `deleteMany` were inherited raw. `createOne({tenantId:'tenant-b'})` or `deleteMany({name:'x'})` inside a tenant-a request reached straight into another tenant. All nine primitives (`findOne`, `find`, `exists`, `count`, `updateOne`, `updateMany`, `findOneAndUpdate`, `deleteOne`, `deleteMany`) are now overridden to scope; `findById`/`updateById`/`deleteById` inherit the confinement through polymorphism. Writes stamp `tenantId` rather than accept one, and the signature narrows to `Omit<Partial<T>,'tenantId'>` so supplying one is a compile error — that is what makes an override honest instead of surprising, and why a separate `createOneInTenant` was rejected: a new name leaves the unsafe method public and turns isolation back into a convention. **Guard order matters**: the empty-filter check runs on the *caller's* filter before scoping, because `{name: undefined}` scoped becomes `{tenantId}` — a perfectly usable filter that would let the mistake through. Escape hatches are `forTenant(id)` for jobs with no CLS context and `acrossTenants()` for deliberately global work (a future platform-admin role); both are greppable, so every place isolation is set aside can be audited, and the authority check belongs in the use case since the repository knows nothing about roles. Inserts are never relaxed — a document must belong to a tenant. Uncovered: a subclass touching `this.model` directly bypasses all of it; review has to catch that |
| D27 | **Input shape is validated by the DTO; use cases validate only what needs loaded state** | Content being non-blank and within the length bound is a property of the request, so `CreateMessageDtos.RequestDto` owns it: the failure becomes a 400 naming the offending field, the bound shows up in Swagger, and there is one place to change it. Duplicating the same two checks inside the use case bought nothing — every caller arrives through the controller. `@Trim()` runs before `@MinLength(1)`, which closes the gap where `"   "` satisfied a three-character minimum. What stays in the use case is what a DTO cannot see: whether the conversation exists in this tenant (404) and whether the sender is a participant (403). The trade-off accepted here: the use case now trusts its input, so a future non-HTTP caller would need its own validation |
| D26 | **Build with `tsc` directly, not `nest build`** | @nestjs/cli resolves its own bundled TypeScript regardless of what the project declares, so the declared compiler was never the one building the app. On this configuration `nest build` also exits 0 while emitting nothing — a silent failure far worse than an error. Compiling with `tsc -p tsconfig.build.json` makes the declared compiler the real one; nothing is lost, since this project uses no Nest CLI compiler plugins and has no assets to copy. The switch also exposed a pre-existing bug: `tsc` leaves the `@/*` path aliases verbatim in the emitted JavaScript, so `node dist/main` — which is what `start:prod` and the Dockerfile's CMD both run — could not resolve them and crashed on boot. `nest start` had been hiding it by registering tsconfig-paths at run time. `tsc-alias` now rewrites the aliases to relative paths after compilation |
| D24 | **MongoDB on host port 27018, Redis on 6380** | The standard ports are commonly already taken by other projects on a developer machine; overridable via `MONGO_HOST_PORT` / `REDIS_HOST_PORT` |
| D22 | **Bulk-index into ES and coalesce `lastMessageAt` per batch** — mandatory, not an optimization | Same estimate: a naive per-document consumer tops out at ~220 msg/s (~13,000 concurrent senders), which *is* within reach of a real live-event chat. Bulk raises it ~30× to ~6,700 msg/s and moves the bottleneck off the consumer onto Kafka. This is what makes D21's acceptance defensible — without it, accepting the risk would not be |
| D13 | **ES coupling to the Mongo schema is acceptable** | ES is a read model **inside the same bounded context** (CQRS). The boundary: once a consumer outside this context subscribes, we must publish a second, curated topic |
| D14 | **One shared ES index + a filtered alias per tenant** | The application only ever knows `messages-{tenantId}`. Switching to index-per-tenant becomes a pure ops migration, zero code change |
| D15 | **Cursor pagination on both read endpoints** | Mongo keyset · ES `search_after`. Avoids the `from + size ≤ 10000` ceiling |
| D16 | **Ordering: server-assigned `timestamp` + `_id` tiebreaker.** No `sentAt`, no `seq` | Client clocks cannot be trusted. `seq` costs an extra round-trip and creates a hot document — not worth it for chat |
| D17 | **No domain layer — invariants live in the use cases** | The aggregates were removed after M1. With one bounded context and one write path they were a validating factory wearing an aggregate's name: 91 lines of `Message.create()` / `Conversation.create()` whose only caller was the use case that immediately unpacked the result field by field back into a persistence shape. Worse, `Conversation.create()` was being used to *rehydrate* rows already in the database, so its invariants re-ran on data that had already passed them. The rules are now plain guards at the top of `handle()`, throwing `UseCaseError` subclasses directly — the pattern the rest of the codebase already used. The tests that covered those rules moved down to the use-case specs, so nothing is unverified; the cost is that they now need a database and run in ~8.5s rather than ~0s |
| D18 | **Test the consumer with fixtures** shaped like Debezium's output; no Kafka Connect inside Jest | Debezium is proven infrastructure; we test the code we wrote. True end-to-end is verified once via compose |
| D19 | **Kafka in KRaft mode**, no Zookeeper | One fewer container |
| D20 | **Approximate `total` for search, no `total` for the message list** | An exact count on a keyset query is a second, expensive query |

---

## 3. Architecture

### 3.1 Processes (one image, several commands)

| Entrypoint | Role | Scales with |
|---|---|---|
| `src/main.ts` | HTTP API — writes and reads Mongo, searches ES | requests/sec |
| `src/main.consumer.ts` | Kafka consumer group → indexes into ES, updates `lastMessageAt` | consumer lag |
| *(Kafka Connect)* | Debezium MongoDB connector — infrastructure, not our code | partitions |

### 3.2 Write path

```
POST /api/messages
  │
  ├─ JwtStrategyGuard → CLS { tenantId, userId, traceId }
  ├─ ValidationPipe (whitelist: true) — input sanitization
  │
  ├─ CreateMessageUseCase
  │    ├─ conversationRepository.findOne({ _id, tenantId })   → not found = 404
  │    ├─ guards: senderId ∈ participantIds                   → otherwise 403
  │    │          content non-empty, ≤ MAX_MESSAGE_CONTENT_LENGTH → otherwise 400
  │    └─ messageRepository.createOne()   ← ONE insert; server assigns timestamp
  │
  └─ 201

  ▼ (oplog)
Debezium MongoDB connector
  transforms: unwrap → rekey → extractKey → route
  ▼
Kafka topic  messaging.message-created.v1   (6 partitions, key = conversationId)
  ▼
consumer group  message-search-indexer
  ├─ ES index into alias messages-{tenantId}, _id = messageId    ← idempotent upsert
  └─ conversations.updateOne({_id, lastMessageAt: {$lt: ts}}, {$set:{lastMessageAt: ts}})
                                          ↑ conditional: safe under out-of-order delivery
```

**Delivery guarantee.** There is exactly one write (to Mongo), and the event is derived
from the oplog — the same thing that made the write durable. No dual-write gap exists.
Debezium tracks its offset in Kafka Connect and resumes after a crash. This is
at-least-once; the consumer is idempotent because `_id = messageId` makes a repeat index
operation a no-op.

**Known boundary.** CDC only holds while a domain event maps one-to-one onto a single
document write. If we later add something like `MessageRedacted` (an update), or a pure
domain event with no corresponding write, we must go back to an outbox. → ADR-002.

### 3.3 Read path

| Endpoint | Source | Mechanism |
|---|---|---|
| `GET /conversations/:id/messages` | Mongo | Keyset on `{tenantId:1, conversationId:1, timestamp:-1, _id:-1}` |
| `GET /conversations/:id/messages/search?q=` | Elasticsearch | `search_after`, sorted `[_score desc, _id asc]`, through alias `messages-{tenantId}` |

Both return the same envelope: `{ items, nextCursor, hasMore }` (plus an approximate
`total` for search). The cursor is a base64-encoded sort tuple, so clients never learn
whether Mongo or ES is behind it.

### 3.4 Multi-tenancy

`tenantId` **always** comes from CLS (populated from the JWT) and **never** from the body,
params, or query string.

- **Mongo:** `BaseRepository` injects `tenantId` into every filter, on top of the
  empty-filter guard.
- **Elasticsearch:** the alias `messages-{tenantId}` carries `filter: {term:{tenantId}}`
  and a routing value, so isolation is enforced by the infrastructure rather than by the
  application remembering to add a clause.
- Accessing another tenant's resource returns **404**, not 403 — do not confirm existence.

---

## 4. Directory layout

```
migrations/                        migrate-mongo (indexes)
docs/
  PLAN.md                          this file
  back-of-envelope.md              capacity estimate behind D21/D22
  adr/                             7 ADRs
infra/debezium/
  message-connector.json           connector config, versioned
src/
  main.ts                          HTTP entrypoint
  main.consumer.ts                 Kafka consumer entrypoint
  main.setup.ts
  app.module.ts                    commonModules + RoutersModule
  consumer.module.ts               commonModules + ConsumersModule
  module-ref.singleton.ts

  common/                          base.repository · filters · guards · interceptors
                                   decorators · exceptions · constants · types
  cores/
    models/                        message.model · conversation.model  (typegoose)
    repositories/                  constructed from Connection

  infra/
    database/                      mongoose config, autoIndex: false
    logging/                       app.logger.ts  (renamed from RailwayCompatibleLogger)
    cls/                           + tenantId
    caching/                       redis, unchanged
    elasticsearch/                 client · index template · alias resolver

  routers/
    health-check/                  mongo + redis + kafka + es
    conversations/
    messages/
  workflows/
    shared/base-use-case.ts        unchanged
    conversation/create-conversation/
    message/create-message/
    message/get-conversation-messages/
    message/search-conversation-messages/
  consumers/
    message-created/               @EventPattern handler

  test/
    test-helper/                   three modes, ported to Mongo
    factories/                     hand-written BaseFactory
```

---

## 5. Deletion manifest

**Aentry domain:** 23 entities · 27 repositories · `cores/migrations/` (40 files) ·
`workflows/*` (keeping only `shared/base-use-case.ts`) ·
`routers/customers|admin|webhooks|files` · `crons/`

**Externals:** Stripe · S3 · Google/Apple OAuth · Email and its three HTML templates →
delete `ExternalsModule` entirely. Consequently `test/override/*` goes away and
`DEFAULT_MOCKS` becomes empty.

**Railway / Heroku:** `railway/` · `heroku-to-env.sh` · the `deploy:stg`, `log:stg`,
`log:scheduler:stg`, `generate:api`, `generate:types` scripts ·
`swagger-typescript-api.config.js` · `DB_DATABASE=railway`

**Cruft:** `s3-bucket-diff/` · `scripts/` · `memory_bank/` · `src/node_modules/` · the file
literally named `~` · `dist/` · the old `docs/` · the old `CONTEXT.md` · the `new:entity`
script (it generates TypeORM code)

**Keep and adapt:** `.github/workflows/ci-check.yaml` (mysql → mongo) · `docs/adr/` ·
eslint · prettier · tsconfig · Dockerfile

**Rename:** package name `nest-typescript-starter` → `techbank-messaging-api` · Swagger
title `Aentry API Document` → `Messaging API` · `RailwayCompatibleLogger` → `AppLogger`
(and rewrite its doc comment to describe what it actually does: nestjs-pino drops trailing
object params when the message is a string, and this bridge also enriches records with the
CLS `traceId`)

---

## 6. Milestones

Each milestone is a commit that runs. **M1 is the safety line** — there is something
submittable even if Kafka or ES goes sideways.

### M0 — Port the template and strip it

- Copy files without git history; first commit into this repository
- Mongoose + typegoose; repositories constructed from `Connection`
- `AppLogger`; CLS carrying `tenantId`; stateless JWT
- Port the `BaseRepository` guard to `FilterQuery`
- Test harness: `MongoDBContainer`, hand-written `BaseFactory`, `scan-dependencies`
  switched from `DataSource` to `Connection`
- Health check: mongo + redis

**Done when:** `yarn start:dev` boots · `GET /api/health` returns 200 · `yarn test` is
green with three sample specs (smoke app · controller · usecase) proving all three
test-helper modes survived the port

### M1 — Domain + Mongo + REST

- `Conversation` and `Message` models, mappers, repositories
- `migrate-mongo` plus the index migration; `autoIndex: false`
- `POST /api/conversations` · `POST /api/messages` ·
  `GET /conversations/:id/messages` (cursor)
- Use-case and controller specs against a real MongoDB

**Done when:** the full read/write path works, tests are green, and **the app is usable
without Kafka or ES**

### M2 — Kafka + Debezium

- docker-compose: kafka (KRaft) + kafka-connect (Debezium)
- `infra/debezium/message-connector.json` with the SMT chain, plus `yarn debezium:register`
- Verify the topic receives the right shape, the right key, and the right name
- Capture a real event from compose (recorded in §M2 below)

**Done when:** inserting into Mongo produces an event on `messaging.message-created.v1`
keyed by `conversationId`

**Verified on a running stack**, not assumed:

| Check | Result |
|---|---|
| Topic name after `RegexRouter` | `messaging.message-created.v1` |
| Partitions | 6 |
| Record key | the conversation id as a plain hex string |
| Ordering | three messages of one conversation all landed on partition 2 |
| `_id` / `conversationId` encoding | hex strings, **not** extended JSON `{"$oid": …}` — the unwrap transform flattens them |
| Date encoding | epoch milliseconds, **not** ISO strings |
| `metadata` | nested object preserved |
| Added by the unwrap SMT | `__deleted: false` |

A record as it actually appeared on the topic:

```
Partition:3  key="6a7f352caefeeac0e37bd99c"
{
  "_id":            "6a7f352caefeeac0e37bd99f",
  "tenantId":       "tenant-a",
  "conversationId": "6a7f352caefeeac0e37bd99c",
  "senderId":       "alice",
  "content":        "id-rename-1",
  "timestamp":      1786721580916,
  "metadata":       { "probe": 1 },
  "createdAt":      1786721580917,
  "updatedAt":      1786721580917,
  "__deleted":      false
}
```

Recorded here rather than committed as a test fixture: nothing reads a fixture
until M3.2 has a consumer, and committed test data that no test reads drifts from
reality silently — change the SMT chain and the file becomes a lie with nothing
to catch it. M3.2 captures a fresh one when there is something to assert against.

The last three were open questions in the risk table; the ObjectId concern turned
out to be unfounded, and the epoch-millis encoding is something M3.2's consumer has
to convert. The topic name is duplicated between `KafkaTopic` and the connector JSON, and
nothing automated catches them drifting apart — asserting one string equals
another is not a test, it is the same configuration written twice. What catches
it is the end-to-end check above: post a message, watch the topic. Removing the
duplication properly would mean generating the connector config from the enum at
registration time, which is worth doing if the topology grows past one topic.

### Search — M3 through M3.4

Originally one milestone covering the consumer, the index and the search endpoint
together. Split after the first attempt produced a diff too large to review in one
sitting: a reviewer had to hold the Kafka wiring, the Elasticsearch mapping and an
HTTP contract in their head at once to judge any one of them.

Two rules decide where the cuts fall.

**The schema comes first, alone.** It is configuration, not code — no branches, no
logic, nothing a unit test could say anything about. What proves it is applying it
to a running Elasticsearch and reading the mapping back, which is a step in a
terminal, not a committed spec. Keeping it in its own part means that check is the
only thing under review.

**After that, nothing lands before its caller.** Each remaining part is a thin
vertical slice that ends with something demonstrable end to end: the write path
first, then the read path. That is why `indexMany` sits with the consumer that
fills the index and `search` sits with the endpoint that queries it, rather than
both arriving together as a finished "index layer" whose second half nothing calls
for two more parts.

#### M3 — The index schema

- Elasticsearch in compose
- `infra/elasticsearch/message-index.json`: the index template — field mappings,
  `dynamic: strict`, `messages-v1` as the concrete index behind per-tenant aliases
- `MESSAGES_INDEX` and `messageAliasFor()` as constants, so no alias name is ever
  built by hand at a call site
- `pnpm es:apply-templates`: applies the template and creates the index. A deploy
  step rather than boot-time work, for the same reason migrations are — replicas
  would race, and a bad mapping should stop a deploy rather than a request

`dynamic: strict` is the load-bearing choice: without it, a field the mapping does
not know is silently accepted and silently left unsearchable. With it, the write
fails and the deploy is what breaks.

No tests. There is no behaviour here yet — the index has no reader and no writer
until M3.1.

**Done when:** `pnpm es:apply-templates` against a running compose creates
`messages-v1` with the intended mapping, running it a second time changes nothing,
and a document carrying an unmapped field is rejected

#### M3.1 — Writing to the index

- `MessageSearchIndex.indexMany`: one `_bulk` request per batch, documents keyed by
  message id, grouped so each tenant's writes go through its own alias
- Per-tenant filtered alias provisioning, created on first write for a tenant
- Test harness: an Elasticsearch testcontainer, applying the same template file
  `es:apply-templates` uses — so a mapping change cannot pass the tests and fail in
  compose
- Tests: the index against a real Elasticsearch

**Done when:** two tenants holding identical text each see only their own through
their alias, and indexing the same message twice leaves one document

#### M3.2 — The CDC consumer

- `MessageCreatedEvent`: the TypeScript contract for the Debezium record,
  deliberately not written in M2, where nothing consumed one
- `main.consumer.ts` as a second entrypoint over the same image
- **Batch-shaped, not message-shaped**: `eachBatch` feeding `indexMany`.
  Per-document indexing tops out near 220 messages a second and would become the
  pipeline's ceiling long before Kafka is (D22, docs/back-of-envelope.md) — this is
  what makes the hot-partition risk accepted in D21 defensible, so it ships in the
  first cut rather than as a later optimization
- Offsets resolved only after the batch is durably indexed. The replay that follows
  a crash is safe because the document id is the message id, so it overwrites
- Tests: the handler over a batch, including redelivery and a mixed-tenant batch

**Done when:** posting a message through the API makes it appear in Elasticsearch
via compose, with no manual step in between

#### M3.3 — The search endpoint

- `MessageSearchIndex.search`: `search_after` over a sort with a tiebreaker, so
  paging cannot repeat or drop a hit when scores tie
- `GET /conversations/:id/messages/search?q=`
- The conversation is resolved in Mongo first, so one belonging to another tenant
  is a 404 rather than an empty page
- Tests: the query against a real Elasticsearch · use case · controller

**Done when:** a term posted through `POST /api/messages` is findable through the
endpoint, another tenant's identical text is not, and paging walks every hit
exactly once

#### M3.4 — `lastMessageAt`

- Coalesced to one conditional update per conversation per batch, not one per
  message (D22)
- The update is conditional on the new timestamp being later, so out-of-order
  redelivery cannot move a conversation backwards

**Done when:** a batch spanning several conversations issues one update each, and
replaying it changes nothing

### M4 — Documentation

- `README.md`: setup, running compose, running tests, architecture, decisions
- `CONTEXT.md`: glossary for the new domain (Tenant · Conversation · Message · Participant)
- The six ADRs in section 7

**Done when:** someone unfamiliar can clone the repo and run it from the README alone

---

## 7. ADRs to write

| # | Title | Trade-off that must be stated |
|---|---|---|
| 001 | Multi-entrypoint instead of a monorepo | Risk of reading as "everything crammed into one app"; migrating into a monorepo later is cheap |
| 002 | CDC (Debezium) instead of a transactional outbox | Events carry the database row shape, coupling consumers to the schema; the boundary once a consumer outside the context subscribes; CDC only holds while events map 1-to-1 onto document writes |
| 002b | Accepting the hot-partition risk of `conversationId` keying (capacity numbers: [back-of-envelope.md](./back-of-envelope.md)) | Throughput for one key is capped at one partition and one consumer — that cap *is* the price of per-key ordering, and the two are mutually exclusive by definition. Adding partitions does **not** help here: `hash(c1) % n` still resolves to a single partition for any `n`. More partitions only reduce collision skew between separate medium-traffic conversations and raise the consumer-group parallelism ceiling. Real mitigations, in order: bulk-index in the consumer (the bottleneck is ES round-trips, not Kafka); accept it (a partition sustains tens of MB/s, far beyond any text conversation); a `conversationId:bucket` composite key, trading strict ordering for throughput; a separate topic for hot conversations. Note that partition count can only ever be increased, and increasing it rewrites the key→partition mapping — ordering is lost across the resize itself, so the initial count is a hard-to-reverse choice. **Outcome: the risk is accepted and none of the sharding mitigations are built** (D21) — with bulk indexing in place the ceiling sits at ~400,000 concurrent senders in a single conversation, far outside this product's shape. The ADR records the mitigations so a future team facing live-event chat traffic has the analysis ready rather than starting from scratch |
| 003 | Shared ES index with per-tenant filtered aliases | Alias count inflates cluster state at thousands of tenants; document the migration path to index-per-tenant |
| 004 | Cursor pagination without an exact `total` | Cannot jump to page N; search `total` is only a `gte` estimate |
| 005 | Indexes in migrations, `autoIndex: false` | Models lose their self-documenting quality; drift is possible if a migration is forgotten |
| 006 | Ordering by server `timestamp` + `_id` | Sub-second ties across pods can order incorrectly; records why client `sentAt` (clock skew) and `seq` (extra round-trip, hot document) were both rejected |

---

## 8. Environment variables

```
APP_ENV=local|test|stg|prod
PORT=3000
LOG_LEVEL=debug

MONGO_HOST_PORT=27018
REDIS_HOST_PORT=6380
MONGO_URI=mongodb://localhost:27018/messaging?replicaSet=rs0&directConnection=true
REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD
KAFKA_BROKERS=localhost:9092
KAFKA_CONSUMER_GROUP=message-search-indexer
KAFKA_CONNECT_URL=http://localhost:8083
ELASTICSEARCH_NODE=http://localhost:9200
JWT_SECRET=<32 characters>
```

## 9. Scripts

All via pnpm.

```
start:dev · start:prod · start:consumer
migrate:up · migrate:down · migrate:create
es:apply-templates          (M3)
debezium:register           (M2)
test · test:cov · lint · build
```

---

## 10. Deferred — tenant provisioning

There is no tenant lifecycle in this codebase: a `tenantId` arrives in a JWT and every
tenant-shaped resource is created lazily, the first time something needs it. That is a
gap, not a design, and it is where a later phase covering tenant provisioning and user
creation belongs.

**The search alias is the piece that most wants moving.** `MessageSearchIndex.ensureAlias`
creates a tenant's filtered alias the first time that tenant's messages are indexed, and
remembers it in a per-process `Set`. Creating an alias is a tenant-lifecycle event; the
indexing hot path should not be the thing deciding it. Once it moves to provisioning,
`ensureAlias` collapses into `messageAliasFor()` — a pure string, no round trip, and no
cache at all, in memory or otherwise.

Two properties of the present arrangement argue for moving it rather than living with it.

The cache is unbounded: a long-lived consumer holds one string for every tenant it has
ever seen.

And a cache that is *wrong* — an alias deleted behind its back by a reindex, a restore or
a hand-run command — does not fail. `action.auto_create_index` defaults to on, so the
write creates a **concrete index** under the alias's name, mapped dynamically, silently
discarding the `dynamic: strict` guarantee the mapping exists to provide. The alias can
then never be created, because an index already holds the name:

```
invalid_alias_name_exception
Invalid alias name [messages-tenant-x]: an index or data stream exists with the same
name as the alias
```

Recovery is manual: reindex that tenant's documents into `messages-v1` and delete the
phantom index. Verified against Elasticsearch 8.15.3, not assumed.

Worth noting that a shared cache would not have been the safer answer here, and neither is
the in-memory one — both can hold the same wrong entry, and the damage lands on the first
write after they do. What actually removes the failure mode is refusing the auto-create:
restricting `action.auto_create_index` so `messages-*` cannot be conjured by a write turns
a silent, permanent corruption into a loud error. That is worth doing whether or not alias
creation moves to provisioning, and it is cheaper than either.

---

## 11. Risks — verify during implementation

| Risk | Mitigation |
|---|---|
| Exact Debezium MongoDB SMT class name (`io.debezium.connector.mongodb.transforms.ExtractNewDocumentState`) | Verify against real compose in M2 before writing the consumer |
| ~~typegoose ↔ mongoose 8 ↔ Nest 11 compatibility~~ | **Resolved in M0.** mongoose pinned to 8.21.0 to satisfy typegoose's peer range; keyv pinned via pnpm `overrides` because cache-manager pulled a second, structurally incompatible copy |
| ~~`@suites` sociable TestBed with a `Connection` token~~ | **Resolved in M0.** The trap was not @suites but TypeScript: `import mongoose, { Connection } from 'mongoose'` makes `Connection` undefined at run time, so the DI token silently became `undefined`. Named-only imports fix it. Nest framework classes (ModuleRef, Reflector) also had to be excluded from the scanner |
| Kafka Connect is heavy (~1GB JVM, ~2 min compose startup) | Accepted; README states the expected wait and healthcheck |
| Elasticsearch client 8 vs 9 API differences | Pin to whatever the compose image ships |

---

## 12. Note

The template originates from the Aentry code base. Evidence indicates the author is the
owner of this repository (`@tiennguyen17t2/schematics`, the admin email), so it is treated
as their own work. Files are copied without carrying over git history.
