# ADR-002b — Accepting the hot-partition risk of keying by `conversationId`

**Status:** accepted · **Decides:** the Kafka record key, and what is deliberately *not* built to protect it

## Context

Kafka guarantees order **within a partition only**, and a record's partition is
`hash(key) % partitions`. So the key choice *is* the ordering guarantee.

The candidates, and what each gives up:

| Key | Ordering | Distribution |
|---|---|---|
| `_id` | none — one conversation scatters across every partition | perfect |
| `conversationId` | per conversation, which is what a chat needs | uneven: one conversation is one partition |
| `tenantId:conversationId` | per conversation | no better — ObjectIds are already globally unique, so the tenant adds nothing to the hash |

`conversationId` is the only one that orders a conversation, so it was chosen (D12).
The cost is inherent: **throughput for one key is capped at one partition and one
consumer.** That cap is not a flaw in the design, it is the price of per-key
ordering, and the two are mutually exclusive by definition.

Adding partitions does not help a single hot key. `hash(c1) % n` resolves to exactly
one partition for any `n`. More partitions reduce collision skew between separate
medium-traffic conversations and raise the consumer group's parallelism ceiling —
neither of which is the hot-key problem.

## Decision

Key by `conversationId`, six partitions, and **accept the hot-partition risk**. None
of the sharding mitigations below are built.

The acceptance rests on numbers rather than optimism —
[back-of-envelope.md](../back-of-envelope.md) works them out, assuming a
conservative 1 KB event, a conservative 10 MB/s partition, and one message per minute
from a continuously typing user:

| Layer | msg/s | Concurrent typing users in one conversation |
|---|---|---|
| Consumer, one document at a time | ~220 | **~13,000** |
| Consumer, bulk indexed | ~6,700 | ~400,000 |
| Kafka, one partition | ~10,000 | ~600,000 |

The bottom line: with bulk indexing, one conversation saturates before Kafka does, at
roughly **400,000 people typing continuously into the same conversation at once**.
Ordinary messaging — even very large group chats — never approaches this. Live-event
chat does, and that is a different product with a different design.

Note the first row. A naive per-document consumer tops out at ~13,000 concurrent
senders, which *is* reachable. So the acceptance is conditional: it holds because the
consumer is batch-shaped, and it would not hold otherwise. That is why bulk indexing
is recorded as mandatory rather than as an optimization (D22).

## Consequences

**Six partitions is close to irreversible.** Partition count can only be increased,
and increasing it rewrites the key→partition mapping — ordering is lost across the
resize itself, for every conversation in flight. The initial count is therefore a
hard-to-reverse choice, which is why six rather than one: it costs nothing now and
raises the consumer-group ceiling to ~40,000 msg/s aggregate.

**One consumer instance per partition is the parallelism ceiling.** Six partitions
means at most six useful indexer instances; a seventh sits idle.

**The mitigations are documented and not built**, in the order they would be reached
for:

1. **Bulk indexing in the consumer** — done. The bottleneck was Elasticsearch round
   trips, not Kafka, and this is the ~30× that makes everything else unnecessary.
2. **Accept it** — the current position. A partition sustains tens of MB/s, far
   beyond any text conversation.
3. **A `conversationId:bucket` composite key**, spreading one conversation over *k*
   partitions. Trades strict per-conversation ordering for throughput — the consumer
   would then need to reorder, or the product would need to tolerate near-simultaneous
   messages arriving out of order.
4. **A separate topic for hot conversations**, detected and routed dynamically. The
   most flexible and by far the most machinery.

They are recorded here so that a team facing live-event traffic has the analysis
ready rather than starting from scratch — and so that nobody builds them
preemptively, which is the more likely mistake.

**The estimate is most sensitive to send rate.** At 12 messages a minute per user
rather than one, the bulk-consumer ceiling falls from 400,000 to ~33,500 concurrent
senders. Still far outside this product's shape, but the sensitivity is worth knowing
before quoting the headline number.

**Ordering also requires the producer not to reorder on retry.** Verified on the
running stack: the Connect worker's producer defaults to
`max.in.flight.requests.per.connection=1`, which prevents it, and the connector now
sets `producer.override.enable.idempotence=true` so the guarantee is ours rather than
a default's — and so a future throughput tuning of `max.in.flight` stays safe.
