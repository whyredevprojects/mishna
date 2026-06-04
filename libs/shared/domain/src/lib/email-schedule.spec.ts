import { localParts, weekStartOnOrBefore, weekStartToDate } from './email-schedule';

describe('email-schedule', () => {
  describe('localParts', () => {
    it('reports the local wall-clock for a timezone', () => {
      // 2026-06-03T12:00Z is 08:00 in New York (EDT, UTC-4).
      const p = localParts(new Date('2026-06-03T12:00:00Z'), 'America/New_York');
      expect(p).toEqual({ year: 2026, month: 6, day: 3, dow: 3, hour: 8 });
    });

    it('rolls the local date back across midnight (zone behind UTC)', () => {
      // 2026-06-03T02:00Z is 2026-06-02 22:00 in New York.
      const p = localParts(new Date('2026-06-03T02:00:00Z'), 'America/New_York');
      expect(p).toMatchObject({ year: 2026, month: 6, day: 2, hour: 22 });
    });

    it('rolls the local date forward (zone ahead of UTC)', () => {
      // 2026-06-02T23:00Z is 2026-06-03 02:00 in Jerusalem (IDT, UTC+3).
      const p = localParts(new Date('2026-06-02T23:00:00Z'), 'Asia/Jerusalem');
      expect(p).toMatchObject({ year: 2026, month: 6, day: 3, hour: 2 });
      // 08:00 Jerusalem that day == 05:00Z.
      expect(localParts(new Date('2026-06-03T05:00:00Z'), 'Asia/Jerusalem')).toMatchObject(
        { day: 3, hour: 8 },
      );
    });
  });

  describe('weekStartOnOrBefore', () => {
    const parts = localParts(new Date('2026-06-03T12:00:00Z'), 'America/New_York');
    // 2026-06-03 is a Wednesday (dow 3).

    it('returns the same day when it is the anchor weekday', () => {
      expect(weekStartOnOrBefore(parts, 3)).toBe('2026-06-03');
    });

    it('walks back to the most recent earlier anchor weekday', () => {
      expect(weekStartOnOrBefore(parts, 0)).toBe('2026-05-31'); // prior Sunday
      expect(weekStartOnOrBefore(parts, 1)).toBe('2026-06-01'); // prior Monday
    });

    it('wraps to the previous week for a later weekday', () => {
      expect(weekStartOnOrBefore(parts, 5)).toBe('2026-05-29'); // prior Friday
    });
  });

  describe('weekStartToDate', () => {
    it('parses to UTC midnight', () => {
      expect(weekStartToDate('2026-06-03').toISOString()).toBe(
        '2026-06-03T00:00:00.000Z',
      );
    });
  });
});
