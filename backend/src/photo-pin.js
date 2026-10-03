// Optional PIN for face photos (env PHOTO_PIN). When set, the photo list and
// every photo image need the PIN as header `X-Photo-Pin` or query `?pin=`
// (for <img src>). Wrong guesses are rate limited per client IP, so a 4-digit
// PIN can't be brute-forced: 5 misses locks that IP out for 15 minutes.

import { timingSafeEqual } from 'node:crypto';

const MAX_MISSES = 5;
const LOCK_MS = 15 * 60 * 1000;

export class PhotoPinError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createPhotoPin(pin) {
  const misses = new Map(); // ip -> { count, until }
  const expected = pin ? Buffer.from(String(pin)) : null;

  const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();

  return {
    enabled: Boolean(expected),
    // Throws PhotoPinError (401 / 429) unless the request carries the right PIN.
    check(req, url) {
      if (!expected) return;
      const ip = clientIp(req);
      const now = Date.now();
      const entry = misses.get(ip);
      if (entry && entry.until > now) throw new PhotoPinError(429, 'too_many_pin_attempts');
      const given = Buffer.from(String(req.headers['x-photo-pin'] ?? url.searchParams.get('pin') ?? ''));
      if (given.length === expected.length && timingSafeEqual(given, expected)) {
        misses.delete(ip);
        return;
      }
      // A missing PIN is just "locked", not a wrong guess.
      if (given.length) {
        // Misses count within a LOCK_MS window starting at the first miss.
        const recent = entry && now - entry.first < LOCK_MS;
        const count = recent ? entry.count + 1 : 1;
        misses.set(ip, { count, first: recent ? entry.first : now, until: count >= MAX_MISSES ? now + LOCK_MS : 0 });
        if (misses.size > 10_000) misses.clear(); // keep memory bounded
      }
      throw new PhotoPinError(401, 'photo_pin_required');
    },
  };
}
