/**
 * What goes on the wire when a tenant is created.
 *
 * Kept small on purpose: a consumer needs the id to provision against and the
 * name to log, and nothing else. Every field added here is a field another
 * context starts depending on.
 */
export type TenantCreatedEvent = {
  tenantId: string;
  name: string;
  /** Epoch milliseconds, matching how the messaging stream encodes time. */
  createdAt: number;
};
