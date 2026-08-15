import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUserType } from '../types/auth-user.type';

export const GetAuthUser = createParamDecorator(
  (data: keyof AuthUserType | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUserType | undefined;

    return data ? user?.[data] : user;
  },
);
