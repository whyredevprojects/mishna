import type { MishnaRef } from '../models/api.types';

/** Where `/review` remembers the last mishna the user was looking at. */
const KEY = 'mishna.review.last';

/** The last spot the user was reviewing, or null if none/unreadable. */
export function loadReviewSpot(): MishnaRef | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<MishnaRef>;
    if (
      typeof value.mesechta === 'string' &&
      typeof value.perek === 'number' &&
      typeof value.mishna === 'number'
    ) {
      return { mesechta: value.mesechta, perek: value.perek, mishna: value.mishna };
    }
  } catch {
    // Ignore unavailable/corrupt storage — review just starts at the beginning.
  }
  return null;
}

/** Remember the spot the user is reviewing so `/review` can restore it later. */
export function saveReviewSpot(ref: MishnaRef): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ref));
  } catch {
    // Ignore unavailable storage.
  }
}
