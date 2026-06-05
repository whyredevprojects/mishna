import { WeeklyEmail } from '../weekly-email';
import { SAMPLE_ITEMS, SAMPLE_ORIGIN } from './sample-data';

/** Preview entry for `npm run email:dev` — the weekly email with sample mishnayot. */
export default function WeeklyEmailPreview() {
  return <WeeklyEmail items={SAMPLE_ITEMS} appOrigin={SAMPLE_ORIGIN} />;
}
