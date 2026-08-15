/**
 * What Identity puts on `identity.tenant-created.v1`, as this context reads it.
 *
 * A separate declaration from Identity's, deliberately. Two contexts that share a
 * type share a release: changing the shape would break the consumer at compile
 * time in the same commit, which sounds convenient until the two are separate
 * services and the compiler cannot see both. Duplicating it means a change to the
 * producer is a *versioning* problem, which is what it actually is.
 *
 * Only what is used is declared. `name` is on the wire and is not read here.
 */
export type TenantCreatedEvent = {
  tenantId: string;
};

export const isProvisionable = (event: TenantCreatedEvent): boolean =>
  Boolean(event?.tenantId);
