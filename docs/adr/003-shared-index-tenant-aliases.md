# ADR-003 — One Elasticsearch index, a filtered alias per tenant

**Status:** accepted · **Decides:** how tenants are separated inside Elasticsearch

## Context

Every message belongs to a tenant, and no tenant may ever see another's. MongoDB
solves this with `TenantScopedRepository`: the tenant comes from the verified token
via CLS, and every filter is scoped by the repository rather than by its callers, so
a use case cannot leak by forgetting a clause.

Elasticsearch needs an answer of the same strength. Three shapes were available:

**An index per tenant.** Complete physical separation. Each index carries at least
one shard, and a shard is a Lucene index with its own files, memory and merge
threads. A cluster degrades badly somewhere in the low thousands of shards, so this
puts a hard ceiling on tenant count and wastes most of the capacity below it — most
tenants have very little data.

**One index, a `tenantId` filter in every query.** No overhead at all. Isolation
becomes a discipline applied at each call site, which is exactly the property the
MongoDB side was designed to avoid.

**One index, a filtered alias per tenant.** The alias carries the `tenantId` filter
and a routing value; Elasticsearch applies both. Callers name the alias and never the
index.

## Decision

One index, `messages-v1`, with a filtered alias `messages-{tenantId}` per tenant:

```
filter:         { term: { tenantId } }
index_routing:  tenantId
search_routing: tenantId
```

`MessageSearchIndex` is the only code that names the concrete index; everything else
goes through `messageAliasFor(tenantId)`.

The filter and the manual clause compile to the **same Lucene query** — measured, not
assumed: both produce `+content:brown #tenantId:tenant-a`, where `#` is a
non-scoring filter clause. So this costs nothing at query time. What it buys is that
the boundary is enforced by the cluster rather than remembered by the caller, which
is the same reasoning as the repository, applied to the other datastore.

## Consequences

**The alias filter guards reads, not writes.** Verified: indexing a document whose
`tenantId` is `b` *through tenant `a`'s alias* succeeds, and the document then
appears under tenant `b`. Elasticsearch uses the alias only to resolve which index to
write to. What keeps writes correct is that `applyWrites` selects each alias from the
document's own `tenantId`, never from a parameter a caller supplies.

**Deletes must go through the alias too.** The alias carries `index_routing`, so a
document written through it lives on the shard routing chose. A delete addressed to
the concrete index computes the shard from the id instead, looks in the wrong one,
and answers `not_found` — which is *not* an error, so the batch succeeds, the offsets
commit, and a message the user deleted stays searchable for good. Invisible at
`number_of_shards: 1`; the test index is created with three so that the suite can see
it.

**Aliases are cluster state, and cluster state is not free.** Each alias is an entry
replicated to every node and rewritten on every change. Hundreds or a few thousand
tenants are unremarkable; tens of thousands make the alias list itself the problem.
The migration path at that point is *not* back to per-query filters — it is grouping
tenants into a handful of shared indices, with the alias still the name callers use.

**Alias creation now happens twice over, and that is the design.** Identity
publishes `identity.tenant-created.v1` and messaging provisions the alias before the
tenant's first message exists — creating an alias is a tenant-lifecycle event, not
something the indexing hot path should decide. `ensureAlias` still runs on the write
path, cached per process in a `Set`, as the recovery path for an event that was never
seen: publishing it is a dual write, the only one in the system, and a lost publish
degrades to the behaviour that existed before the event did. What made that dangerous
— an alias typo silently becoming a concrete index — is refused by
`action.auto_create_index`.

**Reads never provision.** `search` does not create the alias: a tenant with nothing
indexed simply has none, and `ignore_unavailable` turns that into an empty page.
Creating it on read would mean a search quietly writes to the cluster, and any
stranger's tenant id would leave a permanent artefact behind.

**The index name is versioned.** `messages-v1`, so a mapping change that cannot be
applied in place is a reindex into `messages-v2` followed by repointing aliases,
rather than an outage.
