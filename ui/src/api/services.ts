/**
 * Which service a path belongs to.
 *
 * Both answer on `/api/health`, so a path by itself does not say. Vite proxies these
 * prefixes in development and nginx proxies the same two in the `demo-ui` container,
 * which is what keeps every call same-origin and both services free of a CORS policy
 * (PLAN §10b). The two proxy configs have to be changed together.
 */
export const IDENTITY_BASE = import.meta.env.VITE_IDENTITY_BASE ?? '/identity-api';
export const MESSAGING_BASE = import.meta.env.VITE_MESSAGING_BASE ?? '';

export const identityPath = (path: string): string => `${IDENTITY_BASE}${path}`;
export const messagingPath = (path: string): string => `${MESSAGING_BASE}${path}`;
