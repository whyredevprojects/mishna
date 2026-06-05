import { Text } from '@react-email/components';
import { ResolvedMishna } from '../quota';
import { EmailShell } from './components/email-shell';
import { MishnaList } from './components/mishna-list';
import * as styles from './styles';

export const REMINDER_TITLE = 'Reminder: your mishnayos for this week';

interface ReminderEmailProps {
  pending: ResolvedMishna[];
  appOrigin: string;
}

/** The reminder email: only the mishnayot still not marked learned this week. */
export function ReminderEmail({ pending, appOrigin }: ReminderEmailProps) {
  return (
    <EmailShell title={REMINDER_TITLE} appOrigin={appOrigin}>
      {pending.length > 0 ? (
        <Text style={styles.intro}>
          You still have {pending.length} mishnayos to finish this week:
        </Text>
      ) : (
        <Text style={styles.intro}>
          Nice work — you&apos;ve finished all your mishnayos this week.
        </Text>
      )}
      <MishnaList items={pending} />
    </EmailShell>
  );
}
