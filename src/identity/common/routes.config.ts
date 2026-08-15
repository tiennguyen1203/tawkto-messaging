import { prefixRoutes } from '@/shared/routes.config';

/**
 * `for-demo` is in the path on purpose.
 *
 * These endpoints exist to seed a local demonstration: they create tenants and
 * users, and hand out a token for anyone who asks by name. No password is
 * checked, because there is none. Saying so in the URL means nobody has to read
 * the code to find out, and a route that arrives in front of real users has to be
 * renamed first — which is a change someone will notice.
 *
 * The name is not the guard, though. `ForDemoOnlyGuard` refuses these routes
 * outside a local environment.
 */
export const ROUTES = prefixRoutes('for-demo', {
  tenants: 'tenants',
  users: 'users',
  tokens: 'tokens',
});

export const API_TAGS = {
  forDemo: 'Identity (for demo)',
};
