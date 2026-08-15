import { Transform } from 'class-transformer';

/**
 * Trims surrounding whitespace from an incoming string.
 *
 * Pair this with `@MinLength(1)` on required text fields. Without it a body of
 * `"   "` satisfies `@MinLength(1)` — it really is three characters — and a blank
 * message reaches the database. Trimming first makes the length check mean what
 * it looks like it means, and stores the content the way every chat client
 * displays it.
 */
export function Trim() {
  return Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
