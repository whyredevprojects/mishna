import { WeeklyEmail } from '../weekly-email';
import {
  SAMPLE_LARGE_ITEMS,
  SAMPLE_ORIGIN,
  SAMPLE_MEMORIZED_URL,
  SAMPLE_UNSUBSCRIBE_URL,
} from './sample-data';

/**
 * Preview entry for `npm run email:dev` — ~40 mishnayot, the "returning user's next
 * unlearned bucket" shape.
 *
 * Worth looking at specifically for **Gmail clipping**: Gmail truncates a message
 * over ~102 KB and hides the rest behind "View entire message" — which would bury the
 * footer's visible unsubscribe link, the thing Gmail itself requires. If this preview
 * is near that size, the templates need to shrink before the corpus does.
 */
export default function WeeklyLargePreview() {
  return (
    <WeeklyEmail
      items={SAMPLE_LARGE_ITEMS}
      appOrigin={SAMPLE_ORIGIN}
      unsubscribeUrl={SAMPLE_UNSUBSCRIBE_URL}
      memorizedUrl={SAMPLE_MEMORIZED_URL}
    />
  );
}
