# Back-of-the-Envelope: Hot Partition Capacity

Partitioning the `messaging.message-changed.v1` topic by `conversationId` (decision D12)
buys per-conversation ordering at the cost of capping one conversation's throughput at a
single partition and a single consumer instance. This document estimates where that cap
actually sits, so the "hot partition" risk in ADR-002b is bounded by numbers rather than
intuition.

**Question:** how busy must a single conversation be before it saturates its partition?

---

## 1. Assumptions

| Quantity | Value | Justification |
|---|---|---|
| Event size on the wire | **1 KB** | Four ObjectIds (~96 B) + 200 B content + timestamp + 100 B metadata + JSON field names and punctuation (~150 B) + Kafka record overhead (~100 B) ≈ 670 B. Rounded up, which is conservative — a larger event lowers the Kafka ceiling |
| Single-partition throughput | **10 MB/s** | Deliberately conservative; commonly cited sustained figures are higher |
| Send rate of one actively-typing user | **1 msg/min** = 0.0167 msg/s | Continuous typing with no pauses. See §6 — this is the most sensitive input |
| Elasticsearch single-document index | ~3 ms round-trip | |
| Elasticsearch `_bulk`, 1,000 documents | ~150 ms | Modest cluster |
| MongoDB single update | ~1.5 ms | For the `lastMessageAt` write |

---

## 2. Ceiling per layer

### Kafka, one partition

```
10 MB/s ÷ 1 KB/event          = 10,000 msg/s
10,000 ÷ 0.0167 msg/s per user = ~600,000 concurrent typing users in ONE conversation
```

### Consumer, naive implementation

Indexing one document at a time and issuing one `lastMessageAt` update per message:

```
3 ms (ES) + 1.5 ms (Mongo) = 4.5 ms per message → ~220 msg/s
220 ÷ 0.0167                                    = ~13,000 concurrent typing users
```

### Consumer, bulk implementation

Bulk-indexing into Elasticsearch and coalescing `lastMessageAt` to one update per
conversation per batch:

```
1,000 docs ÷ 150 ms = ~6,700 msg/s
6,700 ÷ 0.0167      = ~400,000 concurrent typing users
```

---

## 3. Result

| Layer | msg/s | Concurrent typing users in one conversation |
|---|---|---|
| Consumer, naive | ~220 | **~13,000** ← the real ceiling of a naive build |
| Consumer, bulk | ~6,700 | ~400,000 |
| Kafka, one partition | ~10,000 | ~600,000 |

**Finding: Kafka is not the bottleneck — it is roughly 45× wider than a naive consumer.**
The intuition that "a partition sustains tens of MB/s so this is fine" is correct about
Kafka but looks at the wrong layer. What saturates first is the consumer's round-trips to
Elasticsearch and MongoDB.

This quantifies the M3 decision to bulk-index from the start: **bulk plus coalesced
updates raises the ceiling by roughly 30×**, from ~13,000 to ~400,000 concurrent senders,
and moves the bottleneck off the consumer and onto Kafka where there is far more headroom.

---

## 4. Reality check

13,000 users **all typing continuously in a single conversation** is not messaging — it is
live-stream chat. Reference points:

- WhatsApp caps groups at 1,024 members
- Large Slack and Teams channels have many members but a far lower message rate
- Twitch and YouTube Live chats for major streams do reach tens of thousands of
  concurrent chatters

So the boundary is well defined: **ordinary messaging never approaches this ceiling;
live-event chat does.** And live-event chat is precisely the workload where the industry
bucket-shards the partition key and gives up strict ordering — which is exactly the
mitigation listed in ADR-002b.

The claim "this essentially never happens" holds — **but only with bulk indexing.**
Without it, the ceiling sits inside the range of a real use case.

---

## 5. Design implications

1. **`lastMessageAt` must be coalesced per batch.** Within a batch of 1,000 messages for
   one conversation, issue a single conditional update carrying the maximum timestamp, not
   1,000 updates. Otherwise MongoDB (~660 msg/s on its own) simply becomes the new
   bottleneck the moment Elasticsearch stops being one.
2. **Bulk indexing is mandatory in M3, not an optimization.** It is the single change that
   makes the hot-partition risk theoretical rather than reachable.

---

## 6. Sensitivity

The send rate per user is the input this estimate is most sensitive to. Everything scales
inversely with it:

| Send rate per active user | Naive consumer (~220 msg/s) | Bulk consumer (~6,700 msg/s) |
|---|---|---|
| 1 msg/min | 13,000 users | 400,000 users |
| 3 msg/min | 4,400 users | 134,000 users |
| 6 msg/min | 2,200 users | 67,000 users |
| 12 msg/min | 1,100 users | 33,500 users |

At 6–12 messages per minute — plausible for a fast-moving event chat — a naive consumer
tops out in the low thousands of users, which is genuinely reachable. The bulk consumer
stays comfortable throughout.

Other ways this estimate could be wrong:

- **Heavy `metadata`** (attachment descriptors, ~5 KB) inflates the event roughly 6×,
  dropping the Kafka ceiling to ~1,700 msg/s (~100,000 users). Does not change the
  conclusion.
- **A small Elasticsearch cluster** might sustain only ~1,000 docs/s on bulk instead of
  6,700, lowering the ceiling to ~60,000 users. Still above ordinary chat.
- **Network latency between consumer and Elasticsearch** dominates the per-batch figure
  more than cluster CPU does; a cross-AZ or cross-region hop would materially change these
  numbers.

---

## 7. Whole-system cross-check

With 6 partitions and one bulk consumer instance per partition:

```
6 × 6,700 msg/s = ~40,000 msg/s aggregate
40,000 × 86,400 = ~3.5 billion messages/day
```

For scale, WhatsApp handles on the order of 100 billion messages per day, so this
configuration sits at roughly 3% of that with six partitions. Six is therefore a sensible
starting point for this exercise, with the caveat from ADR-002b that partition count can
only be increased and that increasing it rewrites the key-to-partition mapping.
