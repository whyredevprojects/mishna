import { Text } from '@react-email/components';
import { ResolvedMishna } from '@mishna/email-domain';
import { EmailShell } from './components/email-shell';
import { MishnaList } from './components/mishna-list';
import * as styles from './styles';

export const REMINDER_TITLE = 'Reminder: your mishnayos for this week';

interface ReminderEmailProps {
  pending: ResolvedMishna[];
  appOrigin: string;
  /** The recipient's signed one-click unsubscribe URL (footer link). */
  unsubscribeUrl?: string;
  /** The recipient's signed "I've memorized this" URL (the top CTA). */
  memorizedUrl?: string;
}

/** The reminder email: only the mishnayot still not marked learned this week. */
export function ReminderEmail({
  pending,
  appOrigin,
  unsubscribeUrl,
  memorizedUrl,
}: ReminderEmailProps) {
  return (
    <EmailShell
      title={REMINDER_TITLE}
      appOrigin={appOrigin}
      unsubscribeUrl={unsubscribeUrl}
      // No "click when you've memorized this" over an empty list.
      memorizedUrl={pending.length > 0 ? memorizedUrl : undefined}
    >
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
