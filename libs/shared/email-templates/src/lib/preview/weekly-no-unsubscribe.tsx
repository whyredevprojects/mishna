import { WeeklyEmail } from '../weekly-email';
import { SAMPLE_ITEMS, SAMPLE_ORIGIN } from './sample-data';

/**
 * Preview entry for `npm run email:dev` — the footer with **no** unsubscribe link
 * (`unsubscribeUrl` omitted).
 *
 * The scheduled emails always pass one, so this is not a production state — it's the
 * control. It exists so a regression that drops the URL is *visible*: without a side
 * -by-side, a footer missing its link still looks like a perfectly normal footer, and
 * the failure mode (Gmail demoting or spam-foldering bulk mail with no visible
 * unsubscribe) shows up in deliverability data weeks later, not in a preview.
 */
export default function WeeklyNoUnsubscribePreview() {
  return <WeeklyEmail items={SAMPLE_ITEMS} appOrigin={SAMPLE_ORIGIN} />;
}
