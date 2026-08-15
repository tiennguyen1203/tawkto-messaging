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
| D12 | **Topic key = `conversationId`** via an SMT chain (not `_id`, not `tenantId:conversationId`) | Kafka only orders within a partition, and `partition = hash(key) % n`. A key unique per record (`_id`) scatters a conversation across partitions and gives up ordering entirely. `conversationId` groups a conversation onto one partition, so one consumer processes it sequentially. Adding `tenantId` would not improve distribution (ObjectIds are already globally unique), complicates the SMT, and worsens hot-partition risk. Not strictly required by today's consumer, but it is the right answer to the graded item and re-keying a live topic later is expensive. **Correction, verified on the running stack in M3.2:** the Connect worker runs with `enable.idempotence=false`, so this requirement is *not* met — yet ordering holds anyway, because the same worker defaults to `max.in.flight.requests.per.connection=1`, and a retry cannot be overtaken when only one request is in flight. The cost of idempotence being off is duplicates, not reordering, and duplicates are already harmless here: the document id is the message id, so a redelivered record overwrites. The exposure is that this rests on a default nobody chose, and `max.in.flight` is the first knob raised to speed a producer up — at 5 with idempotence off, ordering breaks silently. Setting `producer.override.enable.idempotence=true` on the connector makes the higher value safe and removes the duplicates as well |
| D21 | **Accept the hot-partition risk that comes with D12** — no bucket-sharding, no fallback keying | Quantified in [back-of-envelope.md](./back-of-envelope.md): with the bulk consumer of D22, one conversation saturates its partition at roughly **400,000 users typing continuously at once**, and Kafka itself only at ~600,000. Ordinary messaging never approaches this; only live-stream chat does, and that is a different product. Mitigations (bucketed composite key, dedicated topic for hot conversations) are documented in ADR-002b but deliberately not built — they would trade away per-conversation ordering to solve a problem this workload does not have |
| D23 | **pnpm rather than yarn** | Faster installs. Its stricter resolution also surfaced three type dependencies the hoisted layout was masking. `node-linker=hoisted` is set in `.npmrc` because typegoose and @suites both assume a flat tree |
| D25 | **TypeScript 6.0.3** — the newest release the toolchain actually supports | 7.x is the Go rewrite and does not expose the JavaScript compiler API ts-jest needs: it fails at `globalSetup`, taking all 71 tests with it. It also sits outside typescript-eslint's peer range (`<6.1.0`). 6.0.3 is inside both peer ranges and passes typecheck, build, lint and the full suite. Adopting it required three config changes TypeScript 6 makes mandatory: `baseUrl` removed in favour of relative `paths`, `types` named explicitly (auto-discovery of `@types/*` is gone), and `rootDir` stated rather than inferred (TS5011). Verified empirically, not assumed |
| D32 | ~~Rename `_id` to `id` before publishing~~ — **reverted** | The connector briefly carried a `ReplaceField$Value` transform so the wire shape never spelled the primary key Mongo's way. Reverted: the topic has exactly one consumer, our own indexer, inside the bounded context that D13 already accepted coupling within. Renaming one field while `__deleted`, epoch-millisecond dates and the rest of the document stay in Mongo's shape is a half-measure that buys nothing and adds an SMT to get wrong. `_id` never reaching an *API* boundary still holds — that is enforced by the DTOs, which is where it belongs. If a consumer outside this context ever subscribes, the answer is a second curated topic, not a cosmetic rename on this one |
| D33 | **Operational scripts are TypeScript, run through ts-node** | Bash was unreadable and, more usefully, could not import from `src`. The register script now injects `KafkaTopic.MessageChanged` and `MESSAGE_CHANGED_PARTITIONS` into the connector config at registration time — the two keys are absent from the JSON, so the topic name has one source of truth and the producer cannot drift from the consumer. That removes the duplication a deleted config test had been pointlessly guarding. Scripts sit outside the app's `rootDir`, so they get their own `tsconfig.scripts.json`, listed in `pnpm typecheck` and in eslint's project list |
| D34 | **Incremental build state lives inside `dist`**, not at the project root | `prebuild` wipes `dist`; a `.tsbuildinfo` outside it survives, and tsc then skips emitting files whose outputs it believes are still there. The result is a `dist` missing most of the application, produced by a command that exits 0 — the failure only appears as `MODULE_NOT_FOUND` at start. Pairing the cache with the directory it describes makes the two impossible to disagree. `tsconfig.json` runs only with `--noEmit`, so its cache describes nothing and sits in `node_modules/.cache` |
| D35 | **A record missing `_id`, `tenantId` or `conversationId` is dropped by the consumer and refused by the index** | Two layers because they answer different questions. The consumer *drops* — a record shaped by an older transform chain must not fail its batch forever and wedge every message behind it on that partition — and logs what it skipped. The index *throws*, because indexing without a document id is a broken invariant, not a data condition: Elasticsearch generates one, the write succeeds, and the redelivery that was supposed to overwrite writes a second copy instead. The at-least-once pipeline stops being idempotent with nothing reporting it. Found in M3.2 by replaying real topic records, not by a test — every fixture had been well-formed |
| D36 | **One Elasticsearch operation per change event, applied in the order the events arrived** — a create and an update both become `index`, a deletion becomes `delete` | `create` rejects an id that already exists (409), which in an at-least-once pipeline turns every redelivery into a failed batch and a retry loop. `update` merges instead of replacing and 404s when the document is absent — real after a reindex, or once the create has aged off the topic. `index` states the only intent that matters for a read model: make the document equal this. The alternative considered was collapsing a batch to one write per message id, which is order-independent by construction and slightly cheaper; rejected because it requires every event to carry a full post-image forever, and it discards the per-event stream anything else reacting to a change would need. For this workload the two produce the same bulk body in almost every batch — nearly all events are inserts with distinct ids |
| D37 | **Ordering is a chain, and two of its links are configuration** | Verified end to end in M3.2: the change stream is totally ordered at source; `conversationId` as the record key puts a message's whole history on one partition; one partition is read by one consumer; `batch.messages` is offset-ordered; `applyWrites` preserves array order; and Elasticsearch applies bulk actions in sequence per id — the last of which was measured, not assumed (reversing two actions on one id reverses the outcome). The configuration links are `max.in.flight.requests.per.connection` on the producer, now backed by `producer.override.enable.idempotence=true` so a higher value stays safe, and the array order inside `applyWrites`, which is stated in its doc comment and locked by two specs that fail if the operations are grouped or reordered |
| D38 | **Kafka topics are created by a deploy step (`pnpm kafka:create-topics`), not by whoever gets there first** | The connector creates the topic when it publishes its first record, which is later than the consumer's first subscribe — so a fresh environment killed the consumer with `UNKNOWN_TOPIC_OR_PARTITION` before any message existed. Broker-side auto-creation is worse: it would make the topic with the broker's default partition count instead of the six that per-conversation ordering depends on. Same reasoning as indexes in migrations (D8) and the Elasticsearch mapping: provisioning is a deploy step, and a process that finds its topology missing should fail loudly rather than improvise one |
| D39 | **The conversation lookup on the message write path is cached in Redis, keyed by tenant, behind the repository** | `POST /api/v1/messages` opens by loading the conversation to answer two questions — does it exist in this tenant, and is the sender a participant — and it is the endpoint called most often in the product. Measured on compose: 60 messages into one conversation issued **61** `find` commands against MongoDB uncached and **1** cached. The cache lives on `ConversationRepository`, not in the use case, so the key is built from `this.tenantId` — the same CLS-derived value every query on the class is scoped by, which throws rather than falling back when absent. A key assembled by a caller could omit the tenant, and a cache that omits the tenant serves one tenant another's conversation; the spec that would fail is the only one that would, which is why it exists. What is cached is a plain `{ id, participantIds }` projection rather than the document: Redis stores JSON, so a hydrated model would return with `_id` as a string and would be written back into MongoDB as one — and the in-memory store the tests use does not serialise, so nothing would have caught it. Misses are not cached, so a conversation created moments after someone asked for it is visible at once. TTL is 60s and no invalidation exists, which is correct only because nothing mutates a conversation — there is no endpoint that adds or removes a participant. Whoever adds one must delete the key in the same operation |
| D43 | **No distributed lock around cache misses — in-process single-flight only, and even that buys little here** | Concurrent misses on one key ≈ arrival rate × loader duration. The loader is a `findOne` on `{_id, tenantId}` against an index, measured at **0.47 ms**, which puts 1,000 req/s on one replica at 0.47 concurrent callers and 5,000 at 2.3. In-process single-flight was kept because it is free — a `Map`, no I/O — and becomes load-bearing the moment a loader is not cheap; it is not saving anything today. It degrades linearly in replicas, not in requests: N replicas make at most N loader calls when a key goes cold, once per TTL. A distributed lock would cost two Redis round trips on every miss to protect a query cheaper than one of them; make the losers wait on someone else's 0.47 ms plus a poll interval; require a lock TTL that has no correct value (too short and two loaders run anyway, too long and a dead holder blocks the fleet); need a fencing token and a Lua compare-and-delete to avoid releasing a lock it no longer holds; and move Redis from an optimization to a liveness dependency — today Redis down means misses and correct answers. It also would not fix the invalidation race in D42. If the loader ever stops being cheap, the better answers are stale-while-revalidate or probabilistic early expiry, which remove the herd without anyone queueing at all |
| D42 | **Single-flight is not invalidation safety, and `del` alone does not invalidate** | Asked whether `set` has the stampede problem `getOrSet` had: it does not — there is no expensive loader to deduplicate, and collapsing concurrent writes would be wrong, since two callers may be writing different values. But the `set` *inside* `getOrSet` has a worse race. A loader that started before an invalidation writes what it already fetched, landing after the `del` and restoring the stale value for a full TTL. Reproduced against a real Redis: a participant removed at t=50ms was still in the cache after the loader returned at t=300ms, and would have stayed for the minute. Single-flight does not cause this and slightly widens it, because one shared loader's result is older relative to more callers. Nothing mutates a conversation today so nothing calls `del`, which is why this is recorded rather than fixed — but the instruction left for whoever adds participant mutation said to delete the key, and deleting the key is not sufficient. The cheap correct answer is a versioned key: fold a counter the mutation bumps into the key, so an in-flight write lands on a name nobody reads. Both doc comments now say so |
| D41 | **The cache accepts only what JSON can express, enforced by the type** | `get<T>` promised a `T` and returned `JSON.parse(JSON.stringify(T))`. The signature was a lie, and an invisible one: the tests run against an in-memory store that does not serialise, so a `Date`, an `ObjectId`, a `Map` or a hydrated mongoose document passes every spec and comes back as something else in production — an `_id` that returns a string and is written back to MongoDB as one. The first fix was to hand-write a plain projection at the one call site that needed it, which protects that call site and nobody else. The constraint is the real fix: `Cacheable` admits primitives, arrays and plain objects, so anything that cannot survive the round trip is a compile error at the call site, naming the field, and the author converts it once and deliberately. Verified against a probe of eight values that must be refused and six that must not. Five `@ts-expect-error` assertions in the spec keep it honest — widening the type makes those directives unused, which is itself an error, so `pnpm typecheck` fails |
| D40 | **`CachingService.getOrSet` serves any present value, and collapses concurrent misses on one key** | Two defects found while adding D39, both measured rather than reviewed. It tested the cached value for *truthiness*, so `0`, `false` and `''` were recomputed on every call — a counter or a flag cached through it did nothing, silently. And every concurrent miss ran the loader, so the instant a hot key expired under load, each in-flight request queried MongoDB at once: the cache stops helping exactly when it is needed most. Presence (`!isNil`) now decides a hit, and the first miss registers a promise the rest await. Single-flight is per process — N replicas still make N calls on a cold key, and a distributed lock is not worth its failure modes for this. A third property was found to be weaker than its comment claimed: skipping the write for a nil result saves a round trip but changes no answer, because a stored `null` reads back as a miss anyway. The mutation that removed the guard killed no test until one was written that asserts the write itself, and the comment was corrected to match |
| D30 | **Collection names are pinned on the model, not derived from the class name** | Typegoose pluralises the class, so `MessageModel` became `messagemodels` while the migration indexed `messages`. The application ran full collection scans and nothing complained — and `migrations.spec.ts` passed *vacuously*, because it explained a query against the hardcoded `messages`, an empty collection that did have the index. IXSCAN on an empty collection is still IXSCAN. The spec now derives the name from `repository.collectionName`, so an assertion can never again be aimed at a collection the application does not use. Found by M2: Debezium was watching `messaging.messages` and no event ever arrived |
| D31 | **`migrate-mongo-config.js` loads `.env` and refuses to default the connection string** | The CLI does not load `.env`, so `MONGO_URI` was undefined and the config silently fell back to `mongodb://localhost:27017/messaging` — an unrelated MongoDB that happened to be listening on the developer's machine. `pnpm migrate:up` created a database and an index inside another project's data store, and reported success. Tests never caught it because the harness sets `MONGO_URI` programmatically; only the CLI path was broken. There is now no default at all: a missing `MONGO_URI` throws with an explanation, because guessing which database to migrate is never the safe choice |
| D29 | **A conversation needs at least two distinct participants** | Two very different requests used to produce identical results: `participantIds: []` (a client that forgot to fill the list) and `participantIds: ['alice']` (a deliberate note-to-self) both answered 201 with a conversation containing only the caller. The API could not tell a bug from an intention. The rule cannot live in the DTO, because the creator is merged in and duplicates collapsed afterwards — the use case is the first point where membership is final, which is also what turns a previously dead guard into a reachable one: its old test passed `creatorId: ''`, a state `JwtStrategy` makes impossible. So the DTO now rejects an empty array (`@ArrayMinSize(1)`, a 400 naming the field) and the use case rejects a final membership below `MIN_CONVERSATION_PARTICIPANTS`. Note-to-self is a real feature in other products; supporting it is a one-line change to that constant, and doing it deliberately beats arriving at it by accident |
| D28 | **`TenantScopedRepository` overrides every filter-taking method; two named doors lead out** | Only reads were confined originally, via a `protected scoped()` helper each repository method had to remember to call — and `createOne`, `updateMany`, `deleteMany` were inherited raw. `createOne({tenantId:'tenant-b'})` or `deleteMany({name:'x'})` inside a tenant-a request reached straight into another tenant. All nine primitives (`findOne`, `find`, `exists`, `count`, `updateOne`, `updateMany`, `findOneAndUpdate`, `deleteOne`, `deleteMany`) are now overridden to scope; `findById`/`updateById`/`deleteById` inherit the confinement through polymorphism. Writes stamp `tenantId` rather than accept one, and the signature narrows to `Omit<Partial<T>,'tenantId'>` so supplying one is a compile error — that is what makes an override honest instead of surprising, and why a separate `createOneInTenant` was rejected: a new name leaves the unsafe method public and turns isolation back into a convention. **Guard order matters**: the empty-filter check runs on the *caller's* filter before scoping, because `{name: undefined}` scoped becomes `{tenantId}` — a perfectly usable filter that would let the mistake through. Escape hatches are `forTenant(id)` for jobs with no CLS context and `acrossTenants()` for deliberately global work (a future platform-admin role); both are greppable, so every place isolation is set aside can be audited, and the authority check belongs in the use case since the repository knows nothing about roles. Inserts are never relaxed — a document must belong to a tenant. Uncovered: a subclass touching `this.model` directly bypasses all of it; review has to catch that |
| D27 | **Input shape is validated by the DTO; use cases validate only what needs loaded state** | Content being non-blank and within the length bound is a property of the request, so `CreateMessageDtos.RequestDto` owns it: the failure becomes a 400 naming the offending field, the bound shows up in Swagger, and there is one place to change it. Duplicating the same two checks inside the use case bought nothing — every caller arrives through the controller. `@Trim()` runs before `@MinLength(1)`, which closes the gap where `"   "` satisfied a three-character minimum. What stays in the use case is what a DTO cannot see: whether the conversation exists in this tenant (404) and whether the sender is a participant (403). The trade-off accepted here: the use case now trusts its input, so a future non-HTTP caller would need its own validation |
| D26 | **Build with `tsc` directly, not `nest build`** | @nestjs/cli resolves its own bundled TypeScript regardless of what the project declares, so the declared compiler was never the one building the app. On this configuration `nest build` also exits 0 while emitting nothing — a silent failure far worse than an error. Compiling with `tsc -p tsconfig.build.json` makes the declared compiler the real one; nothing is lost, since this project uses no Nest CLI compiler plugins and has no assets to copy. The switch also exposed a pre-existing bug: `tsc` leaves the `@/*` path aliases verbatim in the emitted JavaScript, so `node dist/main` — which is what `start:prod` and the Dockerfile's CMD both run — could not resolve them and crashed on boot. `nest start` had been hiding it by registering tsconfig-paths at run time. `tsc-alias` now rewrites the aliases to relative paths after compilation |
| D24 | **MongoDB on host port 27018, Redis on 6380** | The standard ports are commonly already taken by other projects on a developer machine; overridable via `MONGO_HOST_PORT` / `REDIS_HOST_PORT` |
| D22 | **Bulk-index into ES** — mandatory, not an optimization. ~~And coalesce `lastMessageAt` per batch~~ — **not built** | Same estimate: a naive per-document consumer tops out at ~220 msg/s (~13,000 concurrent senders), which *is* within reach of a real live-event chat. Bulk raises it ~30× to ~6,700 msg/s and moves the bottleneck off the consumer onto Kafka. This is what makes D21's acceptance defensible — without it, accepting the risk would not be. The `lastMessageAt` half was dropped in M3.4 rather than built: nothing reads the field. There is no endpoint that lists conversations, so writing it would have added a MongoDB write per batch to maintain data no caller can observe. Dropping it does not weaken the estimate — it removes work from the consumer, so the ceiling above is if anything conservative. What it does mean is that the coalescing pattern the capacity analysis describes is analysis, not code; see §10 |
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
Kafka topic  messaging.message-changed.v1   (6 partitions, key = conversationId)
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
    message-changed/               eachBatch handler

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

**Done when:** inserting into Mongo produces an event on `messaging.message-changed.v1`
keyed by `conversationId`

**Verified on a running stack**, not assumed:

| Check | Result |
|---|---|
| Topic name after `RegexRouter` | `messaging.message-changed.v1` |
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
first, then the read path. That is why the write path sits with the consumer that
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

- `MessageSearchIndex.applyWrites`: one `_bulk` request per batch, documents keyed
  by message id, each write addressed to its tenant's alias
- Per-tenant filtered alias provisioning, created on first write for a tenant
- Test harness: an Elasticsearch testcontainer, applying the same template file
  `es:apply-templates` uses — so a mapping change cannot pass the tests and fail in
  compose
- Tests: the index against a real Elasticsearch

**Done when:** two tenants holding identical text each see only their own through
their alias, and indexing the same message twice leaves one document

#### M3.2 — The CDC consumer

- `MessageChangeEvent`: the TypeScript contract for the Debezium record,
  deliberately not written in M2, where nothing consumed one
- `main.consumer.ts` as a second entrypoint over the same image
- **Batch-shaped, not message-shaped**: `eachBatch` feeding `applyWrites`.
  Per-document indexing tops out near 220 messages a second and would become the
  pipeline's ceiling long before Kafka is (D22, docs/back-of-envelope.md) — this is
  what makes the hot-partition risk accepted in D21 defensible, so it ships in the
  first cut rather than as a later optimization
- Offsets resolved only after the batch is durably indexed. The replay that follows
  a crash is safe because the document id is the message id, so it overwrites
- Tests: the handler over a batch, including redelivery and a mixed-tenant batch

**Done when:** posting a message through the API makes it appear in Elasticsearch
via compose, with no manual step in between

Extended after the first cut to carry the whole change stream rather than inserts
alone — the topic was renamed from `message-created` once an update was shown to
travel over it, and deletions now remove the document instead of being dropped
(D36).

**Verified on a running stack**, not assumed:

| Check | Result |
|---|---|
| `POST /api/v1/messages` → searchable in Elasticsearch | ~2s, no manual step |
| Editing the message in MongoDB | the indexed document is replaced in place |
| Deleting it | the document is removed; the connector stays RUNNING |
| Document id | the message id, so redelivery overwrites |
| Tenant isolation end to end | two tenants posted identical text; each alias returned only its own |
| Unmapped fields | none; `dynamic: strict` still reports the seven mapped fields |
| Replay | offsets reset to earliest twice; the index settled on the same three documents both times, and folding the topic's own history by hand predicts exactly those three |

The replay check is the one worth reading twice, because the first attempt at it
proved nothing: restarting the consumer resumes from committed offsets, so
`fromBeginning: true` never applies and no record is re-read. Resetting the group's
offsets is what actually replays.

Six defects surfaced, all of them latent before M3.2 gave them something to break:

**The incremental build emitted a partial `dist`.** `incremental: true` wrote
`tsconfig.build.tsbuildinfo` at the project root while `prebuild` removed only
`dist/`, so tsc believed outputs it had already emitted were still on disk and
skipped them. Every `pnpm build` after the first produced a `dist` missing most of
the application, exited 0, and failed at start with `MODULE_NOT_FOUND`. The build
info now lives at `dist/.tsbuildinfo`, where `rm -rf dist` takes it too —
incremental state belongs with the outputs it describes (D34).

**`KAFKA_BROKERS` pointed at the wrong listener.** Compose publishes `9094` to the
host; `9092` is the internal listener only other containers can reach. A consumer
started with `pnpm start:consumer` could never connect. Nothing had run the
consumer against compose before, so nothing had noticed.

**Malformed records silently broke idempotence.** Records published before D32 was
reverted carry `id` rather than `_id`. They parse cleanly, map to a document with
`messageId: undefined`, and Elasticsearch then generates an id — so each replay
wrote *another* copy. `dynamic: strict` does not catch it, because the field is
absent rather than unknown, and an absent `tenantId` would likewise route to
`messages-undefined`. Every unit test had passed, because every fixture was
well-formed; real data on the topic is what exposed it (D35).

**A deletion killed change data capture outright.** Not "deletes were ignored" — the
connector task died and captured nothing further, of any operation, until its
offsets were reset by hand. A MongoDB delete carries only the document key, so the
`ValueToKey` transform re-keying records by `conversationId` threw on a record it
re-read on every restart. Fixed with pre-images, which are two settings that only
work together: the `collMod` in
`migrations/20260815000000-enable-message-change-stream-pre-images.js`, and
`capture.mode` on the connector. The mode is
`change_streams_update_full_with_pre_image` and not `change_streams_with_pre_image`:
the latter attaches the *before* image and drops the *after* one, so deletes start
working and updates break instead — which is precisely what happened, because the
probe that chose the mode had only exercised an insert and a delete.

**A delete addressed to the concrete index silently does nothing.** Documents are
written through an alias carrying `index_routing`, so a delete sent without that
routing computes the shard from the id, looks in the wrong one, and answers
`not_found` while the document stays put — and `not_found` is not an error, so the
batch succeeds and the offsets commit. A message the user deleted would remain
searchable for good. Invisible under `number_of_shards: 1`, which is why the test
index is created with three: the one place the suite deliberately differs from
production, and it differs by being stricter.

**The consumer could not start on a fresh environment.** The topic was being created
as a side effect of the connector's first publish, which happens after the consumer
subscribes, so the process died with `UNKNOWN_TOPIC_OR_PARTITION` and stayed down.
Topic creation is now its own deploy step (D38).

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

**Verified on a running stack**, not assumed:

| Check | Result |
|---|---|
| Term posted through the API, then searched | found within ~2s, scoped to the conversation |
| Another tenant asking for that conversation | **404**, though it holds a message with identical text |
| `q` missing · blank · no token | 400 · 400 · 401 |
| Paging at `limit=1` | walked every hit exactly once, `hasMore` false on the last page |

Two decisions worth stating, because both could reasonably have gone the other way.

**MongoDB is asked first, and it is what answers "may this caller see this
conversation".** Searching Elasticsearch directly would return an empty page for
another tenant's conversation, which a client reads as "no matches" — indistinguishable
from an empty conversation of their own. The tenant-scoped repository turns that
into a 404, which is also what the listing endpoint answers, so the two agree.

**Reads never provision.** `search` does not call `ensureAlias`: a tenant with
nothing indexed has no alias, and `ignore_unavailable` turns that into an empty page.
Creating the alias on a read would mean a search quietly writes to the cluster, and
any stranger's tenant id would leave a permanent artefact behind.

#### M3.4 — `lastMessageAt` — **dropped, not deferred by accident**

The plan was one conditional update per conversation per batch, guarded on the new
timestamp being later so that out-of-order redelivery could not move a conversation
backwards.

It was dropped when the work came up, because **nothing reads the field**. There is
no endpoint that lists conversations — the API creates them, posts messages into
them, and reads messages back — so `lastMessageAt` would have been maintained for no
caller. The unused `lastMessageAt` property has been removed from the model along
with it; a schema that advertises a field nothing ever sets is worse than one that
does not mention it.

Two things would make it worth building, and either is a fine follow-up:

- **A conversation list.** `GET /api/v1/conversations` ordered by recent activity is
  the obvious next endpoint for a messaging product, and it is what gives the field a
  reader. The keyset machinery and the compound-index discipline are already here.
- **An unread count or activity feed**, which needs the same write.

Recorded here rather than left silently undone, because D22 and
[back-of-envelope.md](./back-of-envelope.md) both describe the coalescing pattern.
That analysis stands — it is why the consumer is batch-shaped — but the
`lastMessageAt` write it describes is analysis, not code.

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
KAFKA_BROKERS=localhost:9094
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
