/**
 * The authenticated principal, decoded from the JWT.
 *
 * `tenantId` is the anchor of multi-tenancy: it is read here once, pushed into
 * CLS, and every repository scopes its queries by it. It must never be accepted
 * from a request body, param or query string.
 */
export type AuthUserType = {
  id: string;
  tenantId: string;
  roles: string[];
};

export enum RoleEnum {
  Member = 'member',
  Admin = 'admin',
}
