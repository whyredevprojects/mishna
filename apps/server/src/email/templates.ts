import { ResolvedMishna } from './quota';

// Hebrew-only, right-to-left email templates. Inline styles only (email clients
// strip <style>/external CSS). The mishnayot are grouped by tractate, each shown
// with its perek:mishna and full Hebrew text.

export interface BuiltEmail {
  subject: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Render the resolved mishnayot as RTL HTML blocks, grouped by tractate. */
function renderMishnayot(items: ResolvedMishna[]): string {
  const blocks: string[] = [];
  let currentTractate = '';
  for (const item of items) {
    if (item.tractateHebrew !== currentTractate) {
      currentTractate = item.tractateHebrew;
      blocks.push(
        `<h2 style="font-size:18px;margin:24px 0 8px;color:#1a1a1a;">${escapeHtml(
          currentTractate,
        )}</h2>`,
      );
    }
    blocks.push(
      `<div style="margin:0 0 14px;">
         <div style="font-weight:bold;color:#7a5c00;margin-bottom:2px;">פרק ${item.ref.perek}, משנה ${item.ref.mishna}</div>
         <div style="line-height:1.9;color:#1a1a1a;">${escapeHtml(item.hebrew)}</div>
       </div>`,
    );
  }
  return blocks.join('\n');
}

function shell(title: string, body: string, appOrigin: string): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
  <body style="margin:0;background:#f5f3ee;font-family:'Frank Ruhl Libre',Georgia,'Times New Roman',serif;">
    <div style="max-width:640px;margin:0 auto;padding:24px;direction:rtl;text-align:right;">
      <h1 style="font-size:22px;color:#1a1a1a;margin:0 0 16px;">${escapeHtml(title)}</h1>
      ${body}
      <hr style="border:none;border-top:1px solid #ddd;margin:28px 0 16px;" />
      <a href="${appOrigin}/dashboard"
         style="display:inline-block;background:#7a5c00;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;">
        פתח את האפליקציה
      </a>
    </div>
  </body>
</html>`;
}

/** The weekly quota email: every mishna due this coming week, with its text. */
export function weeklyEmail(
  items: ResolvedMishna[],
  appOrigin: string,
): BuiltEmail {
  const intro =
    items.length > 0
      ? `<p style="color:#444;margin:0 0 8px;">אלו המשניות שלך לשבוע הקרוב (${items.length}):</p>`
      : `<p style="color:#444;margin:0 0 8px;">אין משניות מתוזמנות לשבוע זה.</p>`;
  return {
    subject: 'המשניות שלך לשבוע הקרוב',
    html: shell('המשניות שלך לשבוע הקרוב', intro + renderMishnayot(items), appOrigin),
  };
}

/** The reminder email: only the mishnayot still not marked learned this week. */
export function reminderEmail(
  pending: ResolvedMishna[],
  appOrigin: string,
): BuiltEmail {
  const intro =
    pending.length > 0
      ? `<p style="color:#444;margin:0 0 8px;">עדיין נותרו לך ${pending.length} משניות להשלים השבוע:</p>`
      : `<p style="color:#444;margin:0 0 8px;">כל הכבוד! השלמת את כל המשניות שלך לשבוע זה.</p>`;
  return {
    subject: 'תזכורת: המשניות שלך לשבוע',
    html: shell('תזכורת ללימוד', intro + renderMishnayot(pending), appOrigin),
  };
}
