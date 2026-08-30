import { toPlainText } from '@react-email/render';
import { PreparedEmail, ResolvedMishna } from '@mishna/email-domain';
import { composeEmail } from './compose';
import { REMINDER_TITLE } from './reminder-email';
import { reminderEmail, weeklyEmail } from './render';
import { WEEKLY_TITLE } from './weekly-email';

// These assert **semantics**, not full-HTML snapshots: react-email bumps reflow the
// markup (table wrappers, attribute order) without changing a single thing a
// recipient sees, and a snapshot would turn every such bump into a fake failure while
// still not catching a missing mishna.
//
// The byte-level guarantees that only hold in the deployed runtime — a re-render of
// the same batch being byte-identical (the Resend 409 trap), and the headers as
// actually wired — stay in apps/server's workerd integration test. These run under
// node, where @react-email/render uses `renderToPipeableStream` rather than workerd's
// `renderToReadableStream`.

const ORIGIN = 'https://app.test';
const UNSUB = 'https://app.test/api/unsubscribe?t=djEuYWxpY2UuYWxs.c2lnbmF0dXJl';

function item(
  mesechta: string,
  perek: number,
  mishna: number,
  hebrew: string,
): ResolvedMishna {
  return { ref: { mesechta, perek, mishna }, tractateHebrew: 'ברכות', hebrew };
}

const ITEMS: ResolvedMishna[] = [
  item('Berakhot', 1, 1, 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית'),
  item('Berakhot', 1, 2, 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּשַׁחֲרִית'),
  item('Peah', 2, 3, 'אֵלּוּ דְבָרִים שֶׁאֵין לָהֶם שִׁעוּר'),
];

/** How many times `needle` occurs in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('weeklyEmail', () => {
  it('uses the exact subject line', async () => {
    const built = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    expect(built.subject).toBe('Your mishnayos for the coming week');
    expect(built.subject).toBe(WEEKLY_TITLE);
  });

  it('says how many mishnayot are in the email', async () => {
    // Asserted on the text part: React splits `week ({items.length}):` into three
    // text nodes and `renderToString` separates them with `<!-- -->` comments, so the
    // HTML never holds the sentence contiguously even though the reader sees it.
    const { text } = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    expect(text).toContain('Here are your mishnayos for the coming week (3):');
  });

  it('renders every ref label', async () => {
    const { text } = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    for (const { ref } of ITEMS) {
      expect(text).toContain(`Perek ${ref.perek}, Mishna ${ref.mishna}`);
    }
  });

  it('renders each mishna body verbatim, not double-escaped', async () => {
    // React escapes text once; a second pass would show `&amp;#1502;` style mojibake
    // to a recipient. Hebrew has no HTML-special characters, so it must survive as-is.
    const { html } = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    for (const { hebrew } of ITEMS) {
      expect(html).toContain(hebrew);
    }
    expect(html).not.toContain('&amp;#');
  });

  it('emits one tractate heading per tractate, not per mishna', async () => {
    // Two Berakhot mishnayot + one Peah: three <h2>s would mean the grouping in
    // MishnaList broke and the email reads like a list of headings.
    const { html } = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    expect(count(html, '>Berakhot<')).toBe(1);
    expect(count(html, '>Peah<')).toBe(1);
  });

  it('marks the Hebrew body right-to-left and leaves the chrome LTR', async () => {
    const { html } = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    expect(html).toContain('<html dir="ltr" lang="en">');
    expect(count(html, 'dir="rtl"')).toBe(ITEMS.length);
  });

  it('has an empty state (which admin send-now can legitimately produce)', async () => {
    // `prepareSingle({ skipWhenEmpty: false })` — the admin send-now path — will hand
    // this template zero refs for a user who has finished their portion. It must read
    // as a deliberate message, not as a broken email.
    const { html, text, subject } = await weeklyEmail([], ORIGIN, UNSUB);
    expect(subject).toBe(WEEKLY_TITLE);
    expect(html).toContain('You have no mishnayos scheduled for this week.');
    expect(text).not.toContain('Perek');
    // ...and the CTA + unsubscribe footer still render, so it is a complete email.
    expect(text).toContain(`${ORIGIN}/dashboard`);
    expect(text).toContain(`Unsubscribe ${UNSUB}`);
  });
});

describe('reminderEmail', () => {
  it('uses the exact subject line', async () => {
    const built = await reminderEmail(ITEMS, ORIGIN, UNSUB);
    expect(built.subject).toBe('Reminder: your mishnayos for this week');
    expect(built.subject).toBe(REMINDER_TITLE);
  });

  it('counts what is still pending', async () => {
    const { text } = await reminderEmail(ITEMS.slice(0, 2), ORIGIN, UNSUB);
    expect(text).toContain('You still have 2 mishnayos to finish this week');
    expect(text).toContain('Perek 1, Mishna 1');
    expect(text).toContain('Perek 1, Mishna 2');
  });

  it('congratulates rather than nags when nothing is pending', async () => {
    const { text } = await reminderEmail([], ORIGIN, UNSUB);
    expect(text).toContain("you've finished all your mishnayos this week");
    expect(text).not.toContain('You still have');
    expect(text).not.toContain('Perek');
  });
});

describe('the unsubscribe footer', () => {
  it('renders a visible link when a URL is given', async () => {
    // Gmail's bulk-sender rules want an in-body link *in addition to* the RFC 8058
    // headers, so the header alone is not enough.
    const { html } = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    expect(html).toContain('Unsubscribe');
    expect(html).toContain(UNSUB.replace(/&/g, '&amp;'));
  });

  it('is entirely absent when no URL is given', async () => {
    // The preview and any future non-bulk use must not render a dead link.
    const { html } = await weeklyEmail(ITEMS, ORIGIN);
    expect(html).not.toContain('Unsubscribe');
    expect(html).not.toContain('/api/unsubscribe');
    // The brand line stays.
    expect(html).toContain('Chevras Mishnayos Baal Peh');
  });

  it('puts the URL on a line of its own in the plain-text part', async () => {
    // The contract with `components/email-shell.tsx`: the footer is *two* paragraphs,
    // because html-to-text renders an anchor as "text href" — a one-line footer would
    // read "Chevras Mishnayos Baal Peh · Unsubscribe https://…" with the URL buried
    // mid-sentence, where text-only clients and copy-paste mangle it.
    const { text } = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    expect(text.split('\n').map((l) => l.trim())).toContain(
      `Unsubscribe ${UNSUB}`,
    );
  });
});

describe('the plain-text part', () => {
  it('is derived from the very HTML being sent', async () => {
    const built = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    expect(built.text).toBe(toPlainText(built.html));
  });

  it('carries the email, not a stub', async () => {
    const { text } = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    // html-to-text upper-cases <h1>/<h2>, hence the shouty title + tractate.
    expect(text).toContain('YOUR MISHNAYOS FOR THE COMING WEEK');
    expect(text).toContain('BERAKHOT');
    expect(text).toContain('Perek 1, Mishna 1');
    expect(text).toContain(ITEMS[0].hebrew);
    expect(text).toContain(`${ORIGIN}/dashboard`); // the CTA's URL
  });

  it('has no markup and no invisible preheader padding', async () => {
    const { text } = await weeklyEmail(ITEMS, ORIGIN, UNSUB);
    // A text part with markup in it is a broken text part.
    expect(text).not.toContain('<');
    // The <Preview> preheader pads with zero-width spaces/non-joiners to 150 chars;
    // react-email's default plainTextSelectors skip it, and a text part opening with
    // 150 invisible characters is exactly what spam filters flag.
    expect(text).not.toMatch(/[\u200B\u200C]/);
  });

  it('keeps the long unsubscribe URL unbroken on one line', async () => {
    // `toPlainText` hard-sets `wordwrap: false`; html-to-text's default 80-column wrap
    // would split this base64url URL across lines and make it unclickable.
    const long = `${ORIGIN}/api/unsubscribe?t=${'a'.repeat(120)}.${'b'.repeat(60)}`;
    const { text } = await weeklyEmail(ITEMS, ORIGIN, long);
    expect(text.split('\n').some((l) => l.includes(long))).toBe(true);
  });
});

describe('escaping', () => {
  it('escapes HTML in a mishna body instead of injecting it', async () => {
    // The Hebrew text comes from a fetched JSON file, not from a user — but it is
    // still untrusted input crossing into markup, and React is what makes that safe.
    const hostile = '<script>alert(1)</script> & "quoted"';
    const { html, text } = await weeklyEmail(
      [item('Berakhot', 1, 1, hostile)],
      ORIGIN,
      UNSUB,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    // ...and the text part shows the original characters back to the reader.
    expect(text).toContain('alert(1)');
    expect(text).not.toContain('&lt;');
  });
});

describe('composeEmail', () => {
  const job: PreparedEmail = {
    userId: 'alice',
    kind: 'weekly',
    weekStart: '2026-01-04',
    to: 'alice@example.com',
    refs: ITEMS.map((i) => i.ref),
  };
  const opts = {
    from: 'Chevras Mishnayos Baal Peh <reminders@app.test>',
    replyTo: 'Chevras Mishnayos Baal Peh <support@app.test>',
    appOrigin: ORIGIN,
    unsubscribeUrl: UNSUB,
  };

  it('passes the addresses straight through', async () => {
    const out = await composeEmail(job, ITEMS, opts);
    expect(out.from).toBe(opts.from);
    expect(out.replyTo).toBe(opts.replyTo);
    expect(out.to).toBe('alice@example.com');
    expect(out.subject).toBe(WEEKLY_TITLE);
    expect(out.html).not.toBe('');
    expect(out.text).not.toBe('');
  });

  it('picks the template from the job kind', async () => {
    const weekly = await composeEmail(job, ITEMS, opts);
    const reminder = await composeEmail({ ...job, kind: 'reminder' }, ITEMS, opts);
    expect(weekly.subject).toBe(WEEKLY_TITLE);
    expect(reminder.subject).toBe(REMINDER_TITLE);
  });

  it('sets exactly the three RFC 8058 headers', async () => {
    const { headers } = await composeEmail(job, ITEMS, opts);
    expect(headers).toEqual({
      'List-Unsubscribe': `<${UNSUB}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'List-Id': 'Mishna study emails <study.app.test>',
    });
  });

  it('is deterministic — two composes of the same job are deep-equal', async () => {
    // The Resend `Idempotency-Key` covers only (user, kind, week); a reused key
    // arriving with a *different* payload is a 409 that fails the retried batch and
    // takes the rest of the hour's batches with it. No clock, no randomness, anywhere.
    const a = await composeEmail(job, ITEMS, opts);
    const b = await composeEmail(job, ITEMS, opts);
    expect(b).toEqual(a);
  });
});
