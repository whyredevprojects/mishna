import { render } from '@react-email/render';
import { ResolvedMishna } from '../quota';
import { ReminderEmail, REMINDER_TITLE } from './reminder-email';
import { WeeklyEmail, WEEKLY_TITLE } from './weekly-email';

// React Email templates, one component per file under `./`. Each email is a
// React component rendered to email-safe HTML (inline styles) at send time via
// `render`. English chrome; the mishna text itself stays Hebrew (RTL). See the
// individual *.tsx files to edit a template.

export interface BuiltEmail {
  subject: string;
  html: string;
}

/** The weekly quota email: every mishna due this coming week, with its text. */
export async function weeklyEmail(
  items: ResolvedMishna[],
  appOrigin: string,
): Promise<BuiltEmail> {
  return {
    subject: WEEKLY_TITLE,
    html: await render(<WeeklyEmail items={items} appOrigin={appOrigin} />),
  };
}

/** The reminder email: only the mishnayot still not marked learned this week. */
export async function reminderEmail(
  pending: ResolvedMishna[],
  appOrigin: string,
): Promise<BuiltEmail> {
  return {
    subject: REMINDER_TITLE,
    html: await render(<ReminderEmail pending={pending} appOrigin={appOrigin} />),
  };
}
