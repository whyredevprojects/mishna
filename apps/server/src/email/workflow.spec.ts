import { describe, expect, it } from 'vitest';
import { batchPlan } from './workflow';

// The one decision the ReminderWorkflow makes, as a pure function. Everything else
// in that file is the durable engine, which is exercised in
// `workflow.integration.test.ts`; this is the part that can (and should) be pinned
// exhaustively in microseconds.

describe('batchPlan', () => {
  it('plans nothing when nobody is due', () => {
    expect(batchPlan(0)).toEqual([]);
  });

  it('is one batch, with no throttle, up to the batch size', () => {
    // Resend's /batch endpoint takes 100 emails; 100 is one call, not two.
    expect(batchPlan(1)).toEqual([
      { n: 0, start: 0, end: 1, throttleAfter: false },
    ]);
    expect(batchPlan(100)).toEqual([
      { n: 0, start: 0, end: 100, throttleAfter: false },
    ]);
  });

  it('starts a second batch at 101, and throttles between them', () => {
    expect(batchPlan(101)).toEqual([
      { n: 0, start: 0, end: 100, throttleAfter: true },
      { n: 1, start: 100, end: 101, throttleAfter: false },
    ]);
  });

  it('throttles between every pair of batches and never after the last', () => {
    // The sleep is there to stay under Resend's rate limit *between* calls. One after
    // the final batch would put a pointless second on every run — and on every retry
    // of one — while rate-limiting nothing.
    const plan = batchPlan(250);
    expect(plan.map((s) => [s.start, s.end])).toEqual([
      [0, 100],
      [100, 200],
      [200, 250],
    ]);
    expect(plan.map((s) => s.throttleAfter)).toEqual([true, true, false]);
    expect(plan.map((s) => s.n)).toEqual([0, 1, 2]);
  });

  it('covers every job exactly once, at any size', () => {
    for (const total of [0, 1, 99, 100, 101, 199, 200, 201, 999, 2000]) {
      const plan = batchPlan(total);
      expect(plan.length, `${total}`).toBe(Math.ceil(total / 100));
      // Contiguous, gap-free, and ending exactly at `total` — an off-by-one here
      // silently drops or double-sends a slice of the hour's mail.
      let cursor = 0;
      for (const step of plan) {
        expect(step.start, `${total}`).toBe(cursor);
        expect(step.end - step.start, `${total}`).toBeLessThanOrEqual(100);
        cursor = step.end;
      }
      expect(cursor, `${total}`).toBe(total);
      // Exactly one throttle fewer than there are batches.
      expect(
        plan.filter((s) => s.throttleAfter).length,
        `${total}`,
      ).toBe(Math.max(0, plan.length - 1));
    }
  });

  it('honors an explicit batch size (the parameter the runtime pins to 100)', () => {
    expect(batchPlan(5, 2).map((s) => [s.start, s.end, s.throttleAfter])).toEqual([
      [0, 2, true],
      [2, 4, true],
      [4, 5, false],
    ]);
  });
});
