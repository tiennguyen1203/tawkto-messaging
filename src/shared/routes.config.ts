/**
 * The parts of the HTTP surface every service shares.
 *
 * A service's own paths and tags live inside that service — see
 * `messaging/common/routes.config.ts`. Keeping them out of here is what stops a
 * shared file from quietly becoming the place both contexts edit.
 */
type RouteConfigs = { [key: string]: string | RouteConfigs };

export const prefixRoutes = <T extends RouteConfigs>(
  prefix: string,
  routes: T,
): T =>
  Object.fromEntries(
    Object.entries(routes).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value ? `${prefix}/${value}` : prefix];
      }
      return [key, prefixRoutes(prefix, value)];
    }),
  ) as T;

export const ROUTE_VERSION = {
  v1: '1',
};

/** Liveness is served by every process, so it is not any one service's route. */
export const HEALTH_ROUTE = 'health';
export const HEALTH_API_TAG = 'Health';
