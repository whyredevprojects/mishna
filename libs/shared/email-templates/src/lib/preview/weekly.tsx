import { WeeklyEmail } from '../weekly-email';
import {
  SAMPLE_ITEMS,
  SAMPLE_ORIGIN,
  SAMPLE_MEMORIZED_URL,
  SAMPLE_UNSUBSCRIBE_URL,
} from './sample-data';

/** Preview entry for `npm run email:dev` — the weekly email with sample mishnayot. */
export default function WeeklyEmailPreview() {
  return (
    <WeeklyEmail
      items={SAMPLE_ITEMS}
      appOrigin={SAMPLE_ORIGIN}
      unsubscribeUrl={SAMPLE_UNSUBSCRIBE_URL}
      memorizedUrl={SAMPLE_MEMORIZED_URL}
    />
  );
}
