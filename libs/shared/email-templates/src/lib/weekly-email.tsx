import { Text } from '@react-email/components';
import { ResolvedMishna } from '@mishna/email-domain';
import { EmailShell } from './components/email-shell';
import { MishnaList } from './components/mishna-list';
import * as styles from './styles';

export const WEEKLY_TITLE = 'Your mishnayos for the coming week';

interface WeeklyEmailProps {
  items: ResolvedMishna[];
  appOrigin: string;
  /** The recipient's signed one-click unsubscribe URL (footer link). */
  unsubscribeUrl?: string;
  /** The recipient's signed "I've memorized this" URL (the top CTA). */
  memorizedUrl?: string;
}

/** The weekly quota email: every mishna due this coming week, with its text. */
export function WeeklyEmail({
  items,
  appOrigin,
  unsubscribeUrl,
  memorizedUrl,
}: WeeklyEmailProps) {
  return (
    <EmailShell
      title={WEEKLY_TITLE}
      appOrigin={appOrigin}
      unsubscribeUrl={unsubscribeUrl}
      // No "click when you've memorized this" over an empty list.
      memorizedUrl={items.length > 0 ? memorizedUrl : undefined}
    >
      {items.length > 0 ? (
        <Text style={styles.intro}>
          Here are your mishnayos for the coming week ({items.length}):
        </Text>
      ) : (
        <Text style={styles.intro}>
          You have no mishnayos scheduled for this week.
        </Text>
      )}
      <MishnaList items={items} />
    </EmailShell>
  );
}
