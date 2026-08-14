import jwt from 'jsonwebtoken';
import { Logger } from '@nestjs/common';
import { AuthUserType } from '../types/auth-user.type';

export type JwtPayload = {
  sub: string;
  tenantId: string;
  roles: string[];
};

export class AuthUtils {
  private static logger = new Logger(AuthUtils.name);

  static generateJwt(user: AuthUserType, expiresIn: string = '1d') {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
    };

    return jwt.sign(payload, this.JWT_SECRET, {
      expiresIn,
    } as jwt.SignOptions);
  }

  static verifyJwt<T extends object>(
    token: string,
  ): { valid: boolean; payload: T | null } {
    try {
      return { valid: true, payload: jwt.verify(token, this.JWT_SECRET) as T };
    } catch (e) {
      this.logger.warn('JWT verification failed', e);
      return { valid: false, payload: null };
    }
  }

  private static get JWT_SECRET() {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not set');
    }

    return jwtSecret;
  }
}
