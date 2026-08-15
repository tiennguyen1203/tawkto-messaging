# ADR-004 — Cursor pagination, and no exact `total`

**Status:** accepted · **Decides:** how message pages are addressed, and what a page reports about the whole result

## Context

Two endpoints return pages of messages: the listing, out of MongoDB, and the search,
out of Elasticsearch. Both are over data that grows without bound and is written to
constantly.

Offset pagination (`?page=5&limit=20`) is what most APIs reach for, and it has two
problems that get worse with exactly this shape of data.

**Cost grows with depth.** `skip(10_000).limit(20)` makes MongoDB walk and discard
ten thousand documents to return twenty. Elasticsearch's `from`/`size` is worse: it
gathers `from + size` hits *per shard*, then merges — which is why the cluster
refuses past `index.max_result_window`, 10,000 by default.

**Pages shift under concurrent writes.** A new message arrives while a client reads
page 2; every subsequent page slides by one, so the reader sees an item twice and
never sees another. In a chat, writes are the normal case, not an edge case.

## Decision

Keyset pagination, with the cursor as an opaque base64 string carrying the sort tuple
of the last item on the page.

MongoDB pages on `{ timestamp, _id }` and Elasticsearch on `search_after` with
`[_score, messageId]`. The two cursor payloads are different because the two sort
orders are different; keeping them opaque is what lets both endpoints present the
same `{ items, nextCursor, hasMore }` contract over entirely different machinery.

The listing does not report a `total`. Search does, and it is approximate.

## Consequences

**Cost is flat.** Page 500 costs what page 1 costs. On the MongoDB side the filter
and sort mirror the compound index `{ tenantId, conversationId, timestamp: -1, _id: -1 }`
exactly, so the query walks the index and never sorts in memory; on the
Elasticsearch side `search_after` starts from the sort values rather than counting
from the beginning.

**Pages cannot be jumped to.** There is no "go to page 7" and no page count. Forward
and, if implemented, backward — nothing else. For a message history, which is read by
scrolling, this costs nothing; for a report with numbered pages it would be the wrong
choice.

**A page boundary needs a tiebreaker, and forgetting one is a silent bug.** Messages
sharing a timestamp would be skipped or repeated across the break, so the MongoDB
cursor compares on the full sort key, not just the timestamp. Search has the same
problem more acutely: `_score` ties are extremely common — every message matching one
term equally scores identically — so the sort is `[_score desc, messageId asc]`. The
spec that covers this seeds seven identically-scoring messages on purpose, and fails
if the tiebreaker is removed.

**The two cursor formats are mutually unintelligible, and neither rejects the
other.** Both are valid base64 JSON. A search cursor read as a time cursor yields
`timestamp: undefined` → `Invalid Date`; a time cursor handed to `search_after` is an
object where an array is required. Today they cannot meet, because each belongs to a
different endpoint. They would meet if the two endpoints were ever merged behind one
route with an optional query term — which is the main reason not to do that. If it
ever happens, cursors need a type tag first, so a mismatch is a 400 rather than a
wrong answer.

**An unreadable cursor serves the first page rather than failing.** A cursor is
opaque, so a client has no way to construct a valid one — a broken one means a
truncated URL or a stale bookmark, and starting over is more useful than a 400.

**No exact `total` on the listing.** An exact count over a keyset query is a second,
unbounded scan of the same range — the very cost the pagination was chosen to avoid —
and no chat UI displays one. Search reports a `total` because Elasticsearch produces
it as a by-product of the query it already ran, but it is capped:
`track_total_hits: 10_000`, past which the number is a floor rather than a count.
The response documents it as approximate.
