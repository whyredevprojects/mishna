import { ResolvedMishna } from '../../quota';

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
