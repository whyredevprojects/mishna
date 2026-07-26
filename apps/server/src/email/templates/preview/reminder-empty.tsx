import { ReminderEmail } from '../reminder-email';
import { SAMPLE_ORIGIN, SAMPLE_UNSUBSCRIBE_URL } from './sample-data';

/** Preview entry for `npm run email:dev` — the reminder email's "all done" empty state. */
export default function ReminderEmailEmptyPreview() {
  return (
    <ReminderEmail
      pending={[]}
      appOrigin={SAMPLE_ORIGIN}
      unsubscribeUrl={SAMPLE_UNSUBSCRIBE_URL}
    />
  );
}
