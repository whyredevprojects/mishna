import { CycleCalendar } from './cycle-calendar';

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

describe('CycleCalendar', () => {
  const cal = new CycleCalendar();

  it('finds the cycle bounds for a mid-cycle date', () => {
    const date = utc('2026-06-02'); // 17 Sivan 5786
    expect(isoOf(cal.cycleStart(date))).toBe('2026-05-17'); // 1 Sivan 5786
    expect(isoOf(cal.cycleEnd(date))).toBe('2027-06-06'); // 1 Sivan 5787
  });

  it('treats 1 Sivan itself as day 0 of the cycle', () => {
    const start = utc('2026-05-17');
    expect(isoOf(cal.cycleStart(start))).toBe('2026-05-17');
    expect(cal.daysSinceCycleStart(start)).toBe(0);
  });

  it('rolls a date before 1 Sivan back to the previous cycle', () => {
    const date = utc('2026-05-16'); // 29 Iyyar 5786, day before RC Sivan
    expect(isoOf(cal.cycleStart(date))).toBe('2025-05-28'); // 1 Sivan 5785
    expect(isoOf(cal.cycleEnd(date))).toBe('2026-05-17');
  });

  it('counts days since cycle start exactly', () => {
    expect(cal.daysSinceCycleStart(utc('2026-06-02'))).toBe(16);
    expect(cal.daysSinceCycleStart(utc('2026-05-18'))).toBe(1);
  });

  it('daysRemaining is inclusive-of-today up to the reset', () => {
    // 2026-05-17 .. 2027-06-06 is 385 days
    expect(cal.daysRemaining(utc('2026-05-17'))).toBe(385);
    // the last learning day before reset has exactly one day left
    expect(cal.daysRemaining(utc('2027-06-05'))).toBe(1);
  });

  it('is independent of host time-of-day within the UTC day', () => {
    const morning = new Date('2026-06-02T01:00:00.000Z');
    const evening = new Date('2026-06-02T23:00:00.000Z');
    expect(cal.daysSinceCycleStart(morning)).toBe(
      cal.daysSinceCycleStart(evening),
    );
  });
});
