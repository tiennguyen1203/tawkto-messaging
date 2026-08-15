# Messaging

Conversations, the messages posted into them, and full-text search over those
messages.

## Language

**Conversation**:
A named set of participants that messages are posted into. It carries no title and
no metadata — it is a permission boundary and nothing more.
_Avoid_: Thread, channel, room, chat

**Message**:
Text posted into a conversation by one participant, at a time the server decides.
_Avoid_: Post, entry, note

**Participant**:
An id inside a conversation, and the only people who may post into it. Messaging
stores whatever ids it is told and never checks them against Identity — see
[CONTEXT-MAP.md](../../CONTEXT-MAP.md).
_Avoid_: Member, user, subscriber

**Tenant**:
The isolation boundary every conversation and message belongs to. Messaging reads it
from a verified token and never accepts it from a request; the tenant itself is
[Identity's](../identity/CONTEXT.md) to define.
_Avoid_: Account, organisation, workspace

**Change event**:
The record of one message being created, edited or deleted, as it travels from
MongoDB to the search index. It is the stored document rather than a curated event,
which is why only this context consumes it.
_Avoid_: Domain event, message event, CDC record

**Read model**:
The search index — a projection of the messages collection that lags behind it.
MongoDB is the source of truth; anything that must be current reads MongoDB.
_Avoid_: Cache, replica, mirror

**Alias**:
The name this context uses to reach one tenant's messages, and the only name it uses.
Which indices sit behind it is a private matter — see
[ADR-003](../../docs/adr/003-shared-index-tenant-aliases.md).
_Avoid_: Index

**Cursor**:
An opaque handle to a position in a page of results. Two kinds exist — one for the
listing, one for search — and neither is intelligible to the other, which is why they
stay opaque.
_Avoid_: Offset, page token, bookmark

---

## Two rules that explain most of the code

**A tenant is never a parameter.** It is inherited from the request, not passed. The
consumer is the exception, because it runs outside a request and has none to inherit.

**Another tenant's resource is a 404, never a 403.** A 403 confirms the resource
exists, which is itself the leak. A non-participant in a conversation they *can* see
is a 403, because its existence is not a secret from them.
