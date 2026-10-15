import { ApiError } from './api-http';
import { isUuid } from './validation';

export const AVATAR_MAX_BYTES = 65_536;
export const AVATAR_SIZE = 256;
export function avatarUrl(id: unknown): string | null {
  return isUuid(id) ? `/api/v1/avatars/${id}/` : null;
}

/** Accept only bounded baseline JPEGs; discard every APP/EXIF/ICC/COM segment.
 * Original files, filenames and trailing payloads are never persisted. */
export function sanitizeAvatar(bytes: Uint8Array): Uint8Array {
  const invalid = (): never => { throw new ApiError('INVALID_REQUEST'); };
  if (bytes.length > AVATAR_MAX_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE');
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) invalid();
  const parts: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2, frame = false;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 255) invalid();
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) invalid();
    const length = bytes[offset] * 256 + bytes[offset + 1];
    const end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    if (marker === 192) {
      if (frame || length < 11 || bytes[offset + 2] !== 8) invalid();
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      const components = bytes[offset + 7];
      if (width !== AVATAR_SIZE || height !== AVATAR_SIZE || ![1, 3].includes(components) || length !== 8 + 3 * components) invalid();
      frame = true;
    } else if (![196, 219, 221, 218, 254].includes(marker) && !(marker >= 224 && marker <= 239)) invalid();
    if (marker === 218) {
      if (!frame || length < 6) invalid();
      let cursor = end;
      while (cursor < bytes.length) {
        if (bytes[cursor++] !== 255) continue;
        const next = bytes[cursor++];
        if (next === 0 || (next >= 208 && next <= 215)) continue;
        if (next !== 217 || cursor !== bytes.length) invalid();
        parts.push(bytes.slice(start, cursor));
        const clean = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
        let at = 0; for (const part of parts) { clean.set(part, at); at += part.length; }
        return clean;
      }
      invalid();
    }
    if (marker !== 254 && !(marker >= 224 && marker <= 239)) parts.push(bytes.slice(start, end));
    offset = end;
  }
  return invalid();
}
