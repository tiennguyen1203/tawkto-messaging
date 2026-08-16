import { beforeEach, describe, expect, it } from 'vitest';

import type { Tenant, User } from '@/api/identity';
import { useSession } from './use-session';

const acme: Tenant = { id: 't1', name: 'Acme', createdAt: '2026-01-01T00:00:00.000Z' };
const globex: Tenant = { id: 't2', name: 'Globex', createdAt: '2026-01-02T00:00:00.000Z' };
const alice: User = {
  id: 'u1',
  tenantId: 't1',
  email: 'alice@acme.test',
  displayName: 'Alice',
  roles: ['user'],
};

describe('@session/use-session', () => {
  const session = useSession();

  beforeEach(() => session.clear());

  describe('when a tenant, a user and a token have been chosen', () => {
    it('should report itself ready', () => {
      session.selectTenant(acme);
      session.selectUser(alice);
      session.setToken('jwt');

      expect(session.isReady.value).toBe(true);
    });
  });

  describe('when the tenant changes', () => {
    it('should drop the user and the token with it', () => {
      // The worst state this tool could be in is a token whose tenantId no longer
      // matches the tenant on screen: messaging would answer for the old one and
      // the page would explain it as the new one.
      session.selectTenant(acme);
      session.selectUser(alice);
      session.setToken('jwt');

      session.selectTenant(globex);

      expect(session.user.value).toBeUndefined();
      expect(session.token.value).toBeUndefined();
      expect(session.isReady.value).toBe(false);
    });
  });

  describe('when the user changes', () => {
    it('should drop the token but keep the tenant', () => {
      session.selectTenant(acme);
      session.selectUser(alice);
      session.setToken('jwt');

      session.selectUser(undefined);

      expect(session.token.value).toBeUndefined();
      expect(session.tenant.value).toEqual(acme);
    });
  });

  describe('when it is imported twice', () => {
    it('should be the same session, because that is the point', () => {
      // The picker writes it and the messaging pane reads it. Two copies would mean
      // a token issued on one page and absent on the next.
      const other = useSession();
      session.selectTenant(acme);

      expect(other.tenant.value).toEqual(acme);
    });
  });

  describe('when something tries to assign to it directly', () => {
    it('should refuse, so every change has a named cause', () => {
      session.selectTenant(acme);

      // @ts-expect-error — readonly is the contract; this proves it at runtime too,
      // since a cast would get past the compiler.
      session.token.value = 'smuggled';

      expect(session.token.value).toBeUndefined();
    });
  });
});
