/**
 * One partition, unlike the six the message stream uses.
 *
 * Tenants are created rarely — a handful a day at most — so there is nothing to
 * spread, and a single partition keeps the whole stream ordered rather than only
 * ordered per key. Raising it later rewrites the key-to-partition mapping, but
 * for a stream whose consumer is idempotent that costs nothing.
 */
export const TENANT_CREATED_PARTITIONS = 1;
