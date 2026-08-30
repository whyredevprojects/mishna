import { WeeklyEmail } from '../weekly-email';
import {
  SAMPLE_ORIGIN,
  SAMPLE_SINGLE_TRACTATE,
  SAMPLE_UNSUBSCRIBE_URL,
} from './sample-data';

/**
 * Preview entry for `npm run email:dev` — the common case: everything in **one**
 * tractate, so there is a single heading. `weekly.tsx` spans two; the difference
 * (does one heading still look intentional, or like a stray label?) only shows up
 * side by side.
 */
export default function WeeklySingleTractatePreview() {
  return (
    <WeeklyEmail
      items={SAMPLE_SINGLE_TRACTATE}
      appOrigin={SAMPLE_ORIGIN}
      unsubscribeUrl={SAMPLE_UNSUBSCRIBE_URL}
    />
  );
}
