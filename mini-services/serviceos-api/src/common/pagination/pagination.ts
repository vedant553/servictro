/**
 * Cursor pagination helpers (Tech Spec §10.1): limit default 25 / max 100,
 * opaque cursors, allowlisted sort fields only.
 */
import { Errors } from '../errors/domain.error';

export interface PageQuery {
  cursor?: string;
  limit: number;
}

export interface CursorPayload {
  id: string;
}

export function parsePageQuery(query: { cursor?: string; limit?: string | number }): PageQuery {
  let limit = 25;
  if (query.limit !== undefined && query.limit !== null && String(query.limit) !== '') {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1) throw Errors.validationFailed([{ field: 'limit', reason: 'must be a positive integer' }]);
    limit = Math.min(limit, 100);
  }
  let cursor: string | undefined;
  if (query.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(String(query.cursor), 'base64url').toString('utf8')) as CursorPayload;
      if (typeof parsed?.id !== 'string') throw new Error('bad');
      cursor = parsed.id;
    } catch {
      throw Errors.validationFailed([{ field: 'cursor', reason: 'invalid cursor' }]);
    }
  }
  return { cursor, limit };
}

export function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

export function pageResult<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    hasMore,
  };
}

/** Allowlist guard for sort parameters — rejects arbitrary fields. */
export function allowSort(sort: string | undefined, allowed: string[], fallback: string): string {
  if (!sort) return fallback;
  if (!allowed.includes(sort.replace(/^-/, ''))) {
    throw Errors.validationFailed([{ field: 'sort', reason: `allowed fields: ${allowed.join(', ')}` }]);
  }
  return sort;
}
