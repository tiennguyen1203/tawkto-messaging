import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { get } from 'lodash';
import { JWT_STRATEGY_NAME } from '../auth-passport/jwt.strategy';
import { IS_PUBLIC_ROUTE } from '../decorators/public-route.decorator';
import { IS_OPTIONAL_AUTH_ROUTE } from '../decorators/optional-auth-route.decorator';

@Injectable()
export class JwtStrategyGuard extends AuthGuard(JWT_STRATEGY_NAME) {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublicRoute = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_ROUTE,
      [context.getHandler(), context.getClass()],
    );

    if (isPublicRoute) {
      return true;
    }

    const isOptionalAuthRoute = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_ROUTE,
      [context.getHandler(), context.getClass()],
    );

    if (isOptionalAuthRoute && !this.#hasAuthentication(context)) {
      return true;
    }

    return super.canActivate(context);
  }

  #hasAuthentication(context: ExecutionContext) {
    return get(context.switchToHttp().getRequest(), 'headers.authorization');
  }
}
