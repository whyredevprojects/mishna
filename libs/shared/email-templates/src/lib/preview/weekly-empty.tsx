import { WeeklyEmail } from '../weekly-email';
import { SAMPLE_ORIGIN, SAMPLE_UNSUBSCRIBE_URL } from './sample-data';

/**
 * Preview entry for `npm run email:dev` — the weekly email's empty state.
 *
 * Reachable in production: admin "send now" runs `prepareSingle` with
 * `skipWhenEmpty: false`, so an admin who presses "Send weekly" on a user who has
 * finished their whole portion gets *this* email rather than a silent no-op. It has
 * to read as a real message.
 */
export default function WeeklyEmailEmptyPreview() {
  return (
    <WeeklyEmail
      items={[]}
      appOrigin={SAMPLE_ORIGIN}
      unsubscribeUrl={SAMPLE_UNSUBSCRIBE_URL}
    />
  );
}
