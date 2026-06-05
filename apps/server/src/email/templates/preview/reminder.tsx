import { ReminderEmail } from '../reminder-email';
import { SAMPLE_ITEMS, SAMPLE_ORIGIN } from './sample-data';

/** Preview entry for `npm run email:dev` — the reminder email with pending mishnayot. */
export default function ReminderEmailPreview() {
  return <ReminderEmail pending={SAMPLE_ITEMS} appOrigin={SAMPLE_ORIGIN} />;
}
