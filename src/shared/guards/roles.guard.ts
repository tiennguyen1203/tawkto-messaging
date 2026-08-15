import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUserType, RoleEnum } from '../types/auth-user.type';

export const REQUIRED_ROLES = 'requiredRoles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<RoleEnum[]>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return true;
    }

    const user: AuthUserType | undefined = context
      .switchToHttp()
      .getRequest().user;

    return required.some((role) => user?.roles?.includes(role));
  }
}

export function RequireRoles(...roles: RoleEnum[]) {
  return applyDecorators(
    SetMetadata(REQUIRED_ROLES, roles),
    UseGuards(RolesGuard),
  );
}
