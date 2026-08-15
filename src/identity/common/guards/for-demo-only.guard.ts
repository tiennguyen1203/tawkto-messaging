import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { env } from '@/shared/constants';

/**
 * Refuses the seeding routes anywhere but a local environment.
 *
 * The `for-demo` in the path says what shape these endpoints are; this says
 * who may call them. They are different statements, and only one of them is
 * enforced — a path is a label, and a label has never stopped a request.
 *
 * These routes create tenants and hand out tokens without checking anything, so
 * reachable in production they would be an open door to every tenant's data. The
 * guard fails closed: an environment it does not recognise is refused.
 *
 * `test` is allowed alongside `local` even though the name says demo — the specs
 * exercise these routes, and a guard the suite has to disable is a guard nobody
 * trusts.
 */
@Injectable()
export class ForDemoOnlyGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    const appEnv = process.env.APP_ENV;

    if (appEnv !== env.APP_ENVS.local && appEnv !== env.APP_ENVS.test) {
      throw new ForbiddenException(
        'These endpoints exist to seed a local demonstration and are disabled here.',
      );
    }

    return true;
  }
}
