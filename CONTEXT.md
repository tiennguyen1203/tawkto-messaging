# Domain context

What the words in this codebase mean, and which of them are load-bearing.

Read this before the code if you are new; read [docs/architecture.md](docs/architecture.md)
alongside it for how the pieces connect, and [docs/adr/](docs/adr/) for why they are
shaped the way they are.

---

## The nouns

### Tenant

The isolation boundary. Every conversation and every message belongs to exactly one,
and nothing crosses.

A `tenantId` is read **once**, from the verified JWT, and pushed into CLS by
[`JwtStrategy`](src/common/auth-passport/jwt.strategy.ts). It is never accepted from a
request body, param or query string. Everything downstream reads it from there.

There is no `Tenant` model. A tenant exists because a token says so — the codebase has
no tenant lifecycle, no provisioning, no directory. That is a real gap, not a
simplification, and it is where per-tenant Elasticsearch aliases should eventually be
created (see [PLAN.md §10](docs/PLAN.md)).

### Conversation

A named set of participants. Created by `POST /api/v1/conversations`; the creator is
added to the participants automatically if they left themselves out.

It carries no title, no metadata and no activity timestamp — a conversation is
currently a permission boundary and nothing more. Only participants may post into it.
There is no endpoint that lists conversations, which is why there is no
`lastMessageAt`: the field would have been maintained for no reader.

### Message

Text posted into a conversation by one participant.

The sender is whoever the token says, never what the body claims. The timestamp is
the server's, for the same reason — see [ADR-006](docs/adr/006-ordering-by-server-timestamp.md).
`metadata` is a free-form object the API stores and returns untouched.

A message is written **once**, to MongoDB. Everything else in the system is downstream
of that write.

### Participant

A user id inside a conversation's `participantIds`. There is no `User` model — user
identity lives in the token, and this service stores only the ids it is told about.

---

## The words that mean something specific here

### Tenant-scoped

Said of a repository, and it is a guarantee rather than a habit.
[`TenantScopedRepository`](src/common/tenant-scoped.repository.ts) overrides **every**
inherited method that takes a filter, so a query is scoped by the repository rather
than by whoever calls it. Writes stamp `tenantId` instead of accepting one —
`Omit<Partial<T>, 'tenantId'>` makes supplying it a compile error.

Two named doors lead out, and only two:

| | For |
|---|---|
| `forTenant(id)` | Work outside a request — consumers, jobs, migrations — which has no CLS to read |
| `acrossTenants()` | Deliberately global work: a platform-admin report, a backfill |

Both are visible at the call site, which is the point. A cross-tenant query should be
impossible to write by accident and trivial to grep for on purpose.

### Change event

A record on `messaging.message-changed.v1`. It is the stored MongoDB document,
flattened by Debezium's unwrap transform — **not** a curated domain event.

`changed`, not `created`: the topic carries inserts, updates and deletions alike. It
was called `message-created` until an update was observed travelling over it.

A deletion is marked by `__deleted: true` and, because change stream pre-images are
enabled, carries the whole previous document. Ids arrive as hex strings and dates as
epoch milliseconds.

### Read model

The Elasticsearch index. It is a projection of the messages collection, maintained by
the consumer, and it is **eventually consistent**: normally about a second behind,
arbitrarily further if the consumer is lagging or stopped.

MongoDB is the source of truth. Anything that must be current reads MongoDB;
`MessageRepository.search` is the one method on that class that does not, and its doc
comment says so.

### Alias

The name the application uses to reach a tenant's messages: `messages-{tenantId}`,
a filtered alias over the single `messages-v1` index. Nothing outside
[`MessageSearchIndex`](src/infra/elasticsearch/message-search.index.ts) names the
concrete index. See [ADR-003](docs/adr/003-shared-index-tenant-aliases.md).

### Cursor

An opaque base64 string carrying the sort tuple of the last item on a page. Two
incompatible payloads exist — `{timestamp, id}` for the MongoDB listing and
`[score, messageId]` for Elasticsearch search — which is why they stay opaque and why
the two endpoints stay separate. See [ADR-004](docs/adr/004-cursor-pagination.md).

### Use case

One directory under `src/workflows/`, one class, one `handle()`. Business rules live
here; controllers validate and translate, repositories fetch, and neither decides
anything.

Errors are returned, not thrown at the caller: `execute()` yields `{ data, error }`,
and `executeOrThrowHttpError()` is what the controller calls to turn a
`NotFoundUseCaseError` into a 404.

---

## Two rules that explain most of the code

**A tenant is never a parameter.** If you find yourself passing `tenantId` into a
use case, something upstream has gone wrong. The exception is the consumer, which
runs outside a request and therefore has no ambient tenant to inherit — it uses
`forTenant()`, deliberately and visibly.

**Another tenant's resource is a 404, never a 403.** A 403 confirms the resource
exists, which is itself the leak. A non-participant in a conversation the caller
*can* see is a 403, because the existence is not a secret from them.
