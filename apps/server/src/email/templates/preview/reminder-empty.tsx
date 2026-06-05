import { ReminderEmail } from '../reminder-email';
import { SAMPLE_ORIGIN } from './sample-data';

/** Preview entry for `npm run email:dev` — the reminder email's "all done" empty state. */
export default function ReminderEmailEmptyPreview() {
  return <ReminderEmail pending={[]} appOrigin={SAMPLE_ORIGIN} />;
}
