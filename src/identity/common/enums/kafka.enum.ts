/**
 * Identity's Kafka topology.
 *
 * `tenant-created` is a **domain event**, not a change record: it says a tenant
 * came into existence, and it is published because another context needs to act
 * on that fact. The messaging change stream (ADR-002) is the opposite — the
 * stored document, flattened, consumed only inside its own context.
 *
 * Messaging holds its own copy of this name and of the payload shape. That
 * duplication is deliberate: sharing the declaration would couple the two
 * contexts at compile time, and the boundary they have is a topic, not a type.
 *
 * The member repeats `Identity` even though the enum already says it, so that the
 * two copies carry the *same* name and one grep finds both. A duplicated contract
 * that cannot be found in one search is a duplicated contract that drifts.
 */
export enum IdentityKafkaTopic {
  IdentityTenantCreated = 'identity.tenant-created.v1',
}
