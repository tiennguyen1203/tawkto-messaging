import { request } from './client';
import { identityPath } from './services';

/**
 * Identity's `for-demo` endpoints, typed once.
 *
 * A page calls these rather than `request` directly, so a path or a field name is
 * written in one place. The shapes mirror the DTOs on the server; if one of them
 * changes, the compiler stops the page that reads it rather than the page silently
 * rendering `undefined`.
 *
 * Everything here is unauthenticated on purpose — these are the routes that hand
 * out the first token, and `ForDemoOnlyGuard` refuses all of them outside a local
 * environment.
 */

export type Tenant = {
  id: string;
  name: string;
  createdAt: string;
};

export type User = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  roles: string[];
};

export type IssuedToken = {
  accessToken: string;
  expiresIn: string;
  user: User;
};

const path = (suffix: string): string => identityPath(`/api/v1/for-demo/${suffix}`);

export const listTenants = async (): Promise<Tenant[]> =>
  (await request<{ items: Tenant[] }>(path('tenants'))).items;

export const createTenant = (name: string): Promise<Tenant> =>
  request<Tenant>(path('tenants'), { method: 'POST', body: { name } });

export const listUsers = async (tenantId: string): Promise<User[]> =>
  (await request<{ items: User[] }>(path('users'), { query: { tenantId } })).items;

export const createUser = (input: {
  tenantId: string;
  email: string;
  displayName: string;
  roles?: string[];
}): Promise<User> => request<User>(path('users'), { method: 'POST', body: input });

export const issueToken = (userId: string): Promise<IssuedToken> =>
  request<IssuedToken>(path('tokens'), { method: 'POST', body: { userId } });
