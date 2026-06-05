import { HDate, months } from '@hebcal/core';

// ---------------------------------------------------------------------------
// CycleCalendar
//
// The learning cycle runs from Rosh Chodesh Sivan (1 Sivan) to the next Rosh
// Chodesh Sivan, and resets each year. This wraps @hebcal/core to answer the
// date questions the allocation logic needs.
//
// All math is done on absolute (Rata Die) day numbers, and every JS Date is
// interpreted by its UTC calendar day, so results are independent of the host
// timezone. (`new HDate(date)` reads *local* Y/M/D, which would be off by a day
// on machines behind UTC — hence the explicit UTC->local-midnight remap.)
// ---------------------------------------------------------------------------

/** Remap a Date so its local Y/M/D equals the input's UTC Y/M/D, then to HDate. */
function hdateOf(date: Date): HDate {
  const local = new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return new HDate(local);
}

/** Absolute day number of a Date, by its UTC calendar day. */
function absOf(date: Date): number {
  return hdateOf(date).abs();
}

/** Absolute day number of 1 Sivan in a given Hebrew year. */
function sivan1Abs(hebrewYear: number): number {
  return new HDate(1, months.SIVAN, hebrewYear).abs();
}

/** A UTC-midnight Date for an absolute day number. */
function dateOfAbs(abs: number): Date {
  const g = new HDate(abs).greg();
  return new Date(Date.UTC(g.getFullYear(), g.getMonth(), g.getDate()));
}

export class CycleCalendar {
  /** Absolute day of the cycle start (1 Sivan) on or before `date`. */
  private cycleStartAbs(date: Date): number {
    const hebrewYear = hdateOf(date).getFullYear();
    const thisYear = sivan1Abs(hebrewYear);
    return absOf(date) >= thisYear ? thisYear : sivan1Abs(hebrewYear - 1);
  }

  /** Absolute day of the cycle end — the next 1 Sivan strictly after the start. */
  private cycleEndAbs(date: Date): number {
    const start = new HDate(this.cycleStartAbs(date));
    return sivan1Abs(start.getFullYear() + 1);
  }

  /** Most recent Rosh Chodesh Sivan on or before `date` (UTC midnight). */
  cycleStart(date: Date): Date {
    return dateOfAbs(this.cycleStartAbs(date));
  }

  /** The Rosh Chodesh Sivan that ends `date`'s cycle (UTC midnight). */
  cycleEnd(date: Date): Date {
    return dateOfAbs(this.cycleEndAbs(date));
  }

  /** Whole days from the cycle start to `date`. 0 on the start day itself. */
  daysSinceCycleStart(date: Date): number {
    return absOf(date) - this.cycleStartAbs(date);
  }

  /**
   * Whole learning days from `date` (inclusive) until the cycle resets. On the
   * cycle start day this is the full cycle length; it reaches 1 on the last day.
   */
  daysRemaining(date: Date): number {
    return this.cycleEndAbs(date) - absOf(date);
  }

  /**
   * The 0-based week bucket `date` falls in, counted in 7-day windows from the
   * cycle start. Days 0-6 are week 0, 7-13 are week 1, … Negative before the
   * cycle starts (the assignment engine guards on that).
   */
  weeksSinceCycleStart(date: Date): number {
    return Math.floor(this.daysSinceCycleStart(date) / 7);
  }

  /**
   * Whole learning weeks from `date` (inclusive) until the cycle resets — the
   * number of distinct week buckets a joiner on `date` will still be assigned.
   * `ceil` of the remaining days, so a partial final week still counts as one.
   */
  weeksRemaining(date: Date): number {
    return Math.ceil(this.daysRemaining(date) / 7);
  }
}
