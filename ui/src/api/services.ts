/**
 * Which service a path belongs to.
 *
 * Both answer on `/api/health`, so a path by itself does not say. In development
 * Vite proxies these prefixes; in the built app identity serves the assets, so its
 * own calls are same-origin and messaging's are not — which is the point at which
 * messaging needs a CORS policy, and not before (PLAN §10b).
 */
export const IDENTITY_BASE = import.meta.env.VITE_IDENTITY_BASE ?? '/identity-api';
export const MESSAGING_BASE = import.meta.env.VITE_MESSAGING_BASE ?? '';

export const identityPath = (path: string): string => `${IDENTITY_BASE}${path}`;
export const messagingPath = (path: string): string => `${MESSAGING_BASE}${path}`;
