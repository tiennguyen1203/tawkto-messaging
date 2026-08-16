# ADR-008 — A dedicated index for a hot tenant, not an index per tenant

**Status:** proposed · **Decides:** what happens when one tenant outgrows the shared index

## Context

[ADR-003](003-shared-index-tenant-aliases.md) put every tenant in one index,
`messages-v1`, behind a filtered alias each. That is right for the shape a
multi-tenant product almost always has: a long tail of small tenants, where an index
each would spend a shard — a whole Lucene index, with its own files, memory and merge
threads — on a few hundred documents.

It stops being right for one tenant, and the failure is not gradual:

- **A whale.** One tenant with two orders of magnitude more messages than the rest
  makes every shard large. Segment merges, heap for field data, and query latency are
  paid by everybody, including the tenants who wrote nothing.
- **A noisy neighbour.** A bulk import for one tenant pushes merge and refresh work
  onto shards that other tenants are reading from. There is no per-tenant throttle
  inside one index.
- **Retention that differs.** One tenant contracted to keep messages for seven years,
  another for ninety days. ILM applies to an index, not to a subset of its documents.
- **Deletion that must be provable.** "Delete this tenant" against a shared index is
  a delete-by-query: slow, versioned, and leaving tombstones until merges pass. A
  regulator asking for evidence of erasure is easier to answer with a dropped index.

None of these is hypothetical at scale, and none of them is a reason to give *every*
tenant an index.

## Decision

**Keep the shared index as the default. Move an individual tenant to a dedicated
index when a measured trigger says so.** Both live behind the same alias name, so no
application code knows which shape a tenant is on.

```
messages-{tenantId}   →  filtered alias over messages-v1          (default)
messages-{tenantId}   →  alias over messages-{tenantId}-v1        (promoted)
```

A tenant is promoted when **any** of these is true, measured rather than guessed:

| Trigger | Threshold | Why this one |
|---|---|---|
| Share of the index | one tenant holds **> 20%** of documents | Below that, its merges are noise to everyone else |
| Absolute size | its documents exceed **~20 GB** | Roughly the shard size where a single shard stops being comfortable |
| Retention | a retention period differing from the default | ILM cannot express a per-document policy |
| Contractual | erasure or residency must be demonstrable | A dropped index is evidence; a delete-by-query is a claim |

Everything below the line stays shared. There is no plan to promote every tenant, and
"we might as well do them all" is the failure this ADR exists to refuse: a cluster
degrades in the low thousands of shards, and cluster state — replicated to every node
and rewritten on every change — grows with index count.

## How the migration runs

The alias is the seam, and `_aliases` actions are atomic, so there is no window where
a caller sees neither index:

1. Create `messages-{tenantId}-v1`. The index template already matches `messages-*`,
   so the mapping arrives with it — no second source of truth.
2. Backfill. Either `_reindex` from `messages-v1` with `{ term: { tenantId } }`, or
   `pnpm es:reindex`, which rebuilds from MongoDB — the source of truth — and does not
   depend on the old layout at all.
3. Swap in one call: remove the filtered alias from `messages-v1`, add the plain alias
   to the new index. Atomic.
4. Delete the tenant's documents from the shared index by query, once reads are
   confirmed to be landing on the new one.

Rolling back is the same four steps with the endpoints exchanged.

## What has to change in the code

Less than it sounds, because everything already addresses `messageAliasFor(tenantId)`
and Elasticsearch does not care whether that name resolves to a filtered alias or a
plain one.

**Unchanged:** `applyWrites`, `search`, the consumer, every use case, every
repository, every DTO.

**Changed:**

| | |
|---|---|
| `ensureAlias()` | Must decide *which* shape a tenant gets, so it needs a source for that — a field on the tenant, or a configured list. Today it always creates the filtered alias |
| Promoted aliases | Carry no `filter` and no `index_routing`: with one tenant per index they are meaningless, and routing every document of an index to one shard would waste the others |
| `apply-es-templates` | Its `index_patterns` is `messages-v*`; a promoted index is `messages-{tenantId}-v1`, which does not match. Widen it to `messages-*` |
| `reindex-messages.ts` | Counts and refreshes `MESSAGES_INDEX` literally. Would need `messages-*` |
| `search-helper.ts` | The test harness creates one index for every spec |

That list is worth keeping honest: the docstring on `MessageSearchIndex` used to claim
the split "changes this file and nothing else", and it does not — it changes three
files and the test harness. Reviewing this ADR is what caught it.

## Consequences

**Cross-tenant search stops being one query.** An admin report today reads one index;
afterwards it fans out across `messages-*`. Correct either way, slower afterwards,
and worth measuring before anything depends on it.

**Two shapes exist at once, so both must stay tested.** The suite has to cover a
promoted tenant and a shared one, or the second shape rots.

**The trigger has to be watched, not remembered.** A threshold nobody measures is a
threshold nobody acts on. Whatever reports index and per-tenant document counts is
part of this decision, not an afterthought to it.

**It does not solve hot partitions upstream.** A tenant hot enough to deserve its own
index is probably also concentrated on one Kafka partition —
[ADR-002b](002b-hot-partition-risk.md) is the same tenant, one layer earlier, and
promoting the index does nothing for it.
