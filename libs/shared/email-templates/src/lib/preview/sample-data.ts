import { ResolvedMishna } from '@mishna/email-domain';

// Sample data for the React Email preview server (`npm run email:dev`). This file
// is a plain `.ts` with no default export, so the preview CLI does not list it as
// a template — it only renders the *.tsx entries in this folder.

// The real app host (config/domains.json → APP_ORIGIN at runtime). The generator
// (`npm run sync:domains`) doesn't reach preview fixtures, so this is hand-kept: a
// stale value here previews links against a domain that no longer exists.
export const SAMPLE_ORIGIN = 'https://app.mishna2go.com';

/**
 * A dummy signed-looking unsubscribe URL so the preview renders the footer link.
 * The real one is minted per recipient at send time (`email/unsubscribe.ts`).
 */
export const SAMPLE_UNSUBSCRIBE_URL = `${SAMPLE_ORIGIN}/api/unsubscribe?t=preview.token`;
export const SAMPLE_MEMORIZED_URL = `${SAMPLE_ORIGIN}/api/memorized?t=preview.token`;

/** A couple of tractates so the preview shows the group-by-tractate headings. */
export const SAMPLE_ITEMS: ResolvedMishna[] = [
  {
    ref: { mesechta: 'Berachos', perek: 1, mishna: 1 },
    tractateHebrew: 'ברכות',
    hebrew:
      'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית. מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן, עַד סוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה, דִּבְרֵי רַבִּי אֱלִיעֶזֶר.',
  },
  {
    ref: { mesechta: 'Berachos', perek: 1, mishna: 2 },
    tractateHebrew: 'ברכות',
    hebrew:
      'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּשַׁחֲרִית. מִשֶּׁיַּכִּיר בֵּין תְּכֵלֶת לְלָבָן.',
  },
  {
    ref: { mesechta: 'Peah', perek: 1, mishna: 1 },
    tractateHebrew: 'פאה',
    hebrew:
      'אֵלּוּ דְבָרִים שֶׁאֵין לָהֶם שִׁעוּר. הַפֵּאָה וְהַבִּכּוּרִים וְהָרֵאָיוֹן וּגְמִילוּת חֲסָדִים וְתַלְמוּד תּוֹרָה.',
  },
];

/**
 * One tractate only — so the preview shows the *single* heading case, which is what
 * most real weekly emails actually look like (a pace of 1-3 mishnayot rarely spans
 * two tractates). `SAMPLE_ITEMS` deliberately spans two, so both need a preview.
 */
export const SAMPLE_SINGLE_TRACTATE: ResolvedMishna[] = SAMPLE_ITEMS.filter(
  (i) => i.ref.mesechta === 'Berachos',
);

/**
 * A deliberately *large* portion (~40 mishnayot across three tractates). Not a pace
 * anyone commits to — it's the shape a returning user's next unlearned bucket takes
 * once they've been away, and the one that finds the layout problems the 3-item
 * previews can't: clipping in Gmail (which truncates a message over ~102 KB and hides
 * the footer — including the unsubscribe link — behind "View entire message"),
 * heading repetition, and the plain-text part's length.
 */
export const SAMPLE_LARGE_ITEMS: ResolvedMishna[] = Array.from(
  { length: 39 },
  (_, i) => {
    const source = SAMPLE_ITEMS[i % SAMPLE_ITEMS.length];
    return {
      ref: {
        mesechta: source.ref.mesechta,
        perek: Math.floor(i / 6) + 1,
        mishna: (i % 6) + 1,
      },
      tractateHebrew: source.tractateHebrew,
      hebrew: source.hebrew,
    };
  },
).sort((a, b) => a.ref.mesechta.localeCompare(b.ref.mesechta));
