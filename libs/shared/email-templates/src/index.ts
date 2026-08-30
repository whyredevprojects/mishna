// Public surface of the @mishna/email-templates library.
//
// The *presentation* half of the email seam: React Email components rendered to
// email-safe HTML + a plain-text alternative, and `composeEmail`, which turns one
// `PreparedEmail` (from @mishna/email-domain) into the `OutgoingEmail` the transport
// sends. No storage, no network, no clock — rendering is a pure function of the job,
// its resolved Hebrew text, and the sender options.

export type { BuiltEmail } from './lib/render';
export { weeklyEmail, reminderEmail } from './lib/render';
export type { ComposeOptions } from './lib/compose';
export { composeEmail } from './lib/compose';

// The components themselves, for previews and for tests that render one in isolation.
export { WeeklyEmail, WEEKLY_TITLE } from './lib/weekly-email';
export { ReminderEmail, REMINDER_TITLE } from './lib/reminder-email';
export { EmailShell } from './lib/components/email-shell';
export { MishnaList } from './lib/components/mishna-list';
export * as styles from './lib/styles';
