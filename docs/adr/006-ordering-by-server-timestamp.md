# ADR-006 — Ordering by server `timestamp`, with `_id` as tiebreaker

**Status:** accepted · **Decides:** what determines the order of messages in a conversation

## Context

A message history has to have an order, and clients disagree about what time it is.
Three candidates:

**A client-supplied `sentAt`.** Honest about when the user pressed send, and
unusable as a sort key: device clocks are wrong by seconds routinely and by hours
occasionally, and nothing stops a client from lying. One skewed phone reorders a
conversation for everyone in it.

**A monotonic per-conversation sequence number.** Exactly what ordering wants, and
expensive to produce. Allocating one means a round trip to a shared counter on the
write path, and that counter is a single hot document per conversation — the
contention this design otherwise works to avoid.

**A server-assigned timestamp.** One clock instead of many, no extra round trip, and
already needed for the response.

## Decision

The server stamps `timestamp` when the message is stored, and the API ignores any
timestamp in the request body — as it ignores any `senderId`, which comes from the
verified token. The sort key is `{ timestamp: -1, _id: -1 }`; `_id` breaks ties.

## Consequences

**Sub-second ties across replicas can order incorrectly.** Two API pods stamping
within the same millisecond will be ordered by `_id`, which is an ObjectId — and an
ObjectId's leading component is a *second*-resolution timestamp, so within one second
the tie is broken by a counter and a machine identifier, not by real time. For two
messages a few milliseconds apart on different pods, the stored order may not be the
order they arrived.

This is accepted. Perceiving it requires two people sending inside the same
millisecond into the same conversation, and the consequence is that two near-
simultaneous messages appear in the other order — which is indistinguishable from
network jitter, and which is what every chat product does. Fixing it properly means
the sequence number rejected above.

**A tiebreaker is not optional.** Without `_id` in both the sort and the cursor
comparison, messages sharing a timestamp are skipped or repeated at a page boundary —
see [ADR-004](./004-cursor-pagination.md).

**Client-side send time is not recorded at all.** Not stored under another name, not
returned. Storing it would invite someone to sort by it later; if a product needs
"sent at 10:03 on your phone", that is a display concern and a separate field
introduced deliberately.

**Kafka ordering is a different mechanism and does not depend on this.** Records are
keyed by `conversationId`, so a conversation's whole history lands on one partition
in offset order — see [ADR-002b](./002b-hot-partition-risk.md). The consumer applies
changes in that order, and the search index sorts by relevance rather than by time,
so `timestamp` never arbitrates there.

**The index exists for it.** `{ tenantId, conversationId, timestamp: -1, _id: -1 }`
mirrors the sort exactly, so MongoDB walks the index and never sorts in memory
([ADR-005](./005-indexes-in-migrations.md)).
