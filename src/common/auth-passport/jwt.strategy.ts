import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuthUserType } from '../types/auth-user.type';
import { JwtPayload } from '../utils/auth.util';
import { AppClsStore } from '@/infra/cls/module';

export const JWT_STRATEGY_NAME = 'jwt';

/**
 * Stateless: the token is the whole authority, there is no session lookup.
 *
 * The one side effect is pushing `tenantId` into CLS. That is the moment the
 * tenant becomes ambient for the rest of the request — every repository reads it
 * from there, so no downstream code has to remember to pass it along, and no
 * request payload can override it.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY_NAME) {
  constructor(
    configService: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthUserType {
    if (!payload?.sub || !payload?.tenantId) {
      throw new UnauthorizedException('invalid_token');
    }

    const user: AuthUserType = {
      id: payload.sub,
      tenantId: payload.tenantId,
      roles: payload.roles ?? [],
    };

    if (this.cls.isActive()) {
      this.cls.set('tenantId', user.tenantId);
      this.cls.set('userId', user.id);
    }

    return user;
  }
}
