/**
 * ULID helper — 26-char lexicographically sortable IDs.
 *
 * Wraps the `ulid` package so we have a single call-site in case we
 * later swap for a different scheme (e.g. `nanoid`, UUIDv7).
 */

import { ulid as ulidFn } from 'ulid';

/** Return a fresh ULID. 26 chars, Crockford Base32, sortable by creation time. */
export function newId(): string {
  return ulidFn();
}
