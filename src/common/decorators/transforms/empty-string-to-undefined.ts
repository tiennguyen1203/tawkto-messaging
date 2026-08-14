import { Transform } from 'class-transformer';

/**
 * Normalises an incoming empty string (`''`) to `undefined`.
 *
 * Pair this with `@IsOptional()` on optional fields: `@IsOptional()` only skips
 * validation for `null`/`undefined`, so an empty string would otherwise still be
 * run through validators like `@IsEmail()` and fail. Clients that send `''` for
 * "no value" (e.g. an unfilled optional email field) then get a 400 instead of
 * the field simply being treated as absent.
 */
export function EmptyStringToUndefined() {
  return Transform(({ value }) => (value === '' ? undefined : value));
}
