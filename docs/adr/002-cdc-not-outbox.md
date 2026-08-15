# ADR-002 — Change data capture instead of a transactional outbox

**Status:** accepted · **Decides:** how a message reaches Kafka after it is stored

## Context

`POST /api/v1/messages` must store a message and, eventually, make it searchable.
Elasticsearch is fed from Kafka. So something has to get the fact of the write onto
a topic.

The failure everyone is trying to avoid is the **dual write**: store to MongoDB,
then publish to Kafka, as two separate operations. Between them the process can
die, the broker can be unreachable, the request can be cancelled. The message is
stored and the event is lost — a message that exists but is permanently
unsearchable, and nothing anywhere reports it. The reverse ordering is no better:
publish then store, and a crash leaves an event for a message that does not exist.

The two standard answers:

**Transactional outbox.** Write the message and an outbox row in one transaction, so
either both land or neither. A relay process then reads the outbox and publishes.
Atomicity comes from the database.

**Change data capture.** Write only the message. A connector tails the database's
own replication log and publishes what it sees. Atomicity is not needed, because
there is only one write.

## Decision

CDC, via Debezium's MongoDB connector on Kafka Connect.

The deciding argument is that the write path here is **a single insert**. The outbox
exists to make two writes atomic; with one write there is nothing to make atomic.
Adopting it would mean introducing a transaction, a second collection, a relay
process and its own delivery semantics — all to solve a problem this write path does
not have.

What CDC costs instead is set out below, and it is not nothing.

## Consequences

**The event is the stored document.** Consumers are coupled to the persistence
schema, not to a curated contract. Rename a field in MongoDB and every consumer sees
it. That is tolerable here because the only consumer is our own indexer, inside the
same bounded context, and the search index is a read model of exactly this data. It
stops being tolerable the moment something outside this context subscribes — and the
answer then is a second, curated topic fed from this one, **not** a gradual
prettying-up of this one. A half-curated event is worse than an honestly raw one,
because it looks like a contract without being one.

That boundary was tested once. The connector briefly carried a transform renaming
`_id` to `id`, so the wire shape would not spell the primary key MongoDB's way. It
was reverted (D32): renaming one field while `__deleted`, epoch-millisecond dates and
everything else stayed in MongoDB's shape bought nothing and added a transform to get
wrong. Keeping `_id` out of the *API* is a real requirement, and the response DTOs are
where it is enforced.

**CDC only holds while events map one-to-one onto document writes.** A domain event
that is not a row change — "conversation archived by an admin", say, where the
interesting fact is the actor and not the diff — has no natural CDC representation.
The first such event is the signal to add an outbox *alongside* this, for that class
of event only, rather than to migrate everything.

**It moves work into infrastructure.** Kafka Connect is a JVM that takes about a
minute to become healthy, and its configuration is now part of the deployable system
(`infra/debezium/message-connector.json`). Operating it is a real cost that a relay
process written in TypeScript would not have had. In exchange, delivery, retries,
offset tracking and resume-after-restart are the connector's problem rather than
ours.

**Ordering and delivery are inherited, not designed.** Records are keyed by
`conversationId`, so one conversation's history lands on one partition in order —
see [ADR-002b](./002b-hot-partition-risk.md). Delivery is at-least-once, so the
consumer must be idempotent; it is, because the Elasticsearch document id is the
message id, making a redelivery an overwrite.

**It required a MongoDB replica set.** Change streams do not exist on a standalone
node, so even local development runs `rs0`.

**Deletes needed pre-images, and finding that out cost an outage.** A MongoDB delete
event carries only the document key. The transform chain re-keys records by
`conversationId`, which a delete does not have — so the connector task died, and kept
dying on the same record after every restart, capturing nothing further of any
operation. The fix is a collection-level `collMod` enabling change stream pre-images
plus `capture.mode: change_streams_update_full_with_pre_image`, and both are needed:
the `..._with_pre_image` mode alone attaches the before-image and drops the
after-image, which fixes deletes and breaks updates instead.

## Alternatives not taken

**Transactional outbox** — rejected above. Worth revisiting if non-row-shaped domain
events appear.

**Publishing from the application after the insert** — the dual write. Rejected;
this is the failure mode the whole decision exists to avoid.

**Application-level change streams**, tailing the oplog from a Node process instead
of Kafka Connect. Tempting — it removes the JVM — but it means writing resume-token
persistence, backoff, partition assignment and offset commits by hand, which is
precisely the code Debezium already is.
