# Architecture

The detail behind the diagram, which lives in the [README](../README.md) where more
people will see it. Kept beside the code so it can be corrected in the same commit as
the thing it describes.

A message is written **once**, to MongoDB. Nothing publishes to Kafka on the
request path — Debezium reads the oplog instead, so there is no moment where the
message is stored but the event is lost.

The topic carries the whole change stream, not just insertions — the name says
`changed` because a create, an edit and a deletion all travel over it. The consumer
takes whole batches off it and turns each event into one Elasticsearch operation, in
the order the events arrived: a create and an edit both write the document whole, a
deletion removes it. Posting a message makes it searchable in about two seconds,
editing it replaces the indexed copy, and deleting it removes it — all verified on
compose, as is searching it: a term posted through the API is findable within a
couple of seconds, scoped to one conversation and one tenant. Every arrow carries
traffic — the one dashed edge is a response, not an unbuilt flow.

**The grey `for-demo` box is the point of the picture.** Identity and the demo client are in it
because neither is the subject: the brief asks for messaging, and these exist so that
messaging can be driven by a person rather than by curl. Identity hands out a token
to anyone who names a user, without checking a credential — `ForDemoOnlyGuard`
refuses every one of those routes outside a local environment. The client is a Vue
app on nginx, which also proxies both APIs so the browser stays on one origin.

Everything outside that box is the service being assessed, and none of it knows the
box exists. Messaging never calls identity; it verifies a signature and reads the
tenant out of the claim. Take the grey box away and messaging is unchanged — you
would simply have to issue your own tokens.

## What state each component is in

Everything in the diagram is green: every component does work in the running system.
Nothing is built-but-unproven and nothing is sketched-but-absent, which is why the
legend has only the one colour and the one grey box.

**Milestone status is not here** — it is in [PROGRESS.md](../PROGRESS.md), which is
the only file that claims what is done and names the check that settled it. A table
of phases in a document about components was a second place for that to drift, and
it drifted.

## How it works

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
context, so a cosmetic rename would buy nothing. `_id` is kept out of the _API_
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

| Entrypoint                       | Compose service      | Role                                              |
| -------------------------------- | -------------------- | ------------------------------------------------- |
| `src/messaging/main.ts`          | `messaging-api`      | HTTP API                                          |
| `src/messaging/main.consumer.ts` | `messaging-consumer` | Kafka → Elasticsearch indexer                     |
| `src/identity/main.ts`           | `identity-api`       | Tenants, users and the tokens that carry them     |
| `migrate-mongo`                  | `migrate`            | One-shot migration runner                         |
| _(Kafka Connect)_                | `kafka-connect`      | Debezium connector — infrastructure, not our code |

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

|                   | For                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------ |
| `forTenant(id)`   | Consumers, jobs and migrations that run outside a request and so have no CLS context |
| `acrossTenants()` | Deliberately global work — a platform-admin report, a backfill across tenants        |

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

### Search tolerates typos

`fuzziness: AUTO` on the match, so `deploymnet` finds `deployment`. AUTO is per term
by length: no edits below three characters, one up to five, two beyond — a blanket
2 would make every short word a match for every other one.

`prefix_length: 1` means the first character must be right. That is what stops a
fuzzy term expanding across the dictionary, and the cost is that a typo in the first
letter is not forgiven. Typos rarely are.

A second, boosted, exact clause sits beside the fuzzy one so that a document
containing the word as typed outranks one that merely resembles it. Not for the
reason you would guess: Elasticsearch already blends the expanded terms' document
frequencies (`top_terms_blended_freqs_50`), so IDF is not the problem. **Field-length
normalisation is.** Measured on a real cluster, searching `bravo` against a long
message containing `bravo` and a short one containing `bravos` scores the near miss
0.91 and the exact hit 0.50 — the reader's own word comes second. The boost puts it
back on top at 1.99.

It is a thumb on the scale, not a guarantee: a long enough message still loses to a
short variant.

### Indexes

Indexes live in `migrations/` and nowhere else; `autoIndex` is off in every
environment. Building indexes at process start is an unbounded blocking operation
on a large collection, and a schema that declares indexes the database may not
actually have is worse than one that declares none. Tests run the same migrations,
so they exercise the real indexes.

Migrations are plain CommonJS so the same files load unchanged from the CLI and
from inside jest, with no build step in between.

## Known gaps

**Search aliases are created twice over, on purpose.** Identity's
`tenant-created` event provisions a tenant's alias before its first message
arrives, and `ensureAlias` still creates one lazily if the event was never seen.
The second is the recovery path rather than the design: publishing is a dual write
— the only one in the system — and a lost publish degrades to the behaviour that
existed before the event did. What made the lost case dangerous, an alias typo
silently becoming a concrete index, is now refused by
`action.auto_create_index`.

**Conversations are listed by creation, not by activity.** `GET /api/v1/conversations`
returns the caller's own, newest first, behind a multikey index on
`(tenantId, participantIds, createdAt, _id)`. A messenger normally sorts by the newest
message, which needs the `lastMessageAt` dropped in M3.4 because nothing read it —
something reads it now, so it is a real candidate again. It stays out because
maintaining it is an extra write on the hottest path in the product, and that is its
own decision.

**The projection cannot rebuild itself from the log.** The connector runs with
`snapshot.mode: no_data` and Kafka retention is finite, so the topic is not a full
history of the collection. `pnpm es:reindex` rebuilds the index from MongoDB instead,
with `--prune` for documents whose message is gone. It was written after a count
found 392 messages against 200 indexed documents — all of the missing predating a
period when the stack was being torn down and rebuilt, and every message since
present.

**The topic name is written twice.** `KafkaTopic.MessageChanged` is injected into
the connector config by `scripts/register-debezium.ts`, so the producer cannot
drift from the consumer — but the collection name in
`infra/debezium/message-connector.json` is still a literal that has to match
`MESSAGES_COLLECTION`.

## Decisions

The reasoning behind each of these — and the trade-offs accepted — is in
[PLAN.md](./PLAN.md). The capacity numbers behind the Kafka partitioning choice
are in [back-of-envelope.md](./back-of-envelope.md).
