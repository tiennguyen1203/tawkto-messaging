import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_ROUTE = 'isOptionalAuthRoute';
/**
 * If the jwt token is given, it will be validated.
 * If the jwt token is not given, the route will be public.
 */
export const OptionalAuthRoute = () =>
  SetMetadata(IS_OPTIONAL_AUTH_ROUTE, true);
