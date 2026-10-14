import { AuthError } from './request-security';

export function parseNickname(value: unknown): string {
  if (typeof value !== 'string') throw new AuthError(400, 'INVALID_REQUEST');
  const nickname = value.trim();
  if (!nickname || nickname.length > 60 || /[\p{Cc}\p{Cf}@<>]/u.test(nickname) || /(?:https?:\/\/|www\.)/i.test(nickname)) {
    throw new AuthError(400, 'INVALID_REQUEST');
  }
  return nickname;
}
