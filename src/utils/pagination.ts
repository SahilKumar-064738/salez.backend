/**
 * Cursor encoding / decoding for stable pagination over time-ordered data.
 *
 * Format: base64(JSON({ id, timestamp }))
 * Both fields are optional — callers use whichever is relevant for their sort key.
 */

export interface CursorPayload {
  id: number;
  timestamp: string;
}

export function encodeCursor(id: number | null, timestamp: string): string {
  return Buffer.from(JSON.stringify({ id, timestamp })).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'timestamp' in (parsed as object)
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}