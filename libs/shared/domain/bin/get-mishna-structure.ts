import {
  MishnahDataset,
  Masechet,
  Perek,
  Seder,
} from '../src/lib/mishna-types';

/**
 * Fetches the complete Mishnah structure from the Sefaria API.
 *
 * Single endpoint: GET /api/shape/Mishnah
 * Returns all 63 tractates in one shot with:
 *   - section  → seder name
 *   - title    → English tractate name
 *   - heTitle  → Hebrew tractate name
 *   - length   → number of perakim
 *   - chapters → array where chapters[i] = mishnayot count in perek (i+1)
 *
 * Run:  npx ts-node mishnah_dataset.ts
 * Or:   npx tsx mishnah_dataset.ts
 */

// ---------------------------------------------------------------------------
// Raw shape from Sefaria /api/shape/:title
// ---------------------------------------------------------------------------

interface SefariaShapeEntry {
  section: string; // e.g. "Seder Zeraim"
  title: string; // e.g. "Mishnah Berakhot"
  heTitle: string; // e.g. "משנה ברכות"
  book: string;
  heBook: string;
  length: number; // perakim count
  chapters: number[]; // chapters[i] = mishnayot in perek i+1
}

// ---------------------------------------------------------------------------
// Fetch + transform
// ---------------------------------------------------------------------------

async function fetchMishnahDataset(): Promise<MishnahDataset> {
  const res = await fetch('https://www.sefaria.org/api/shape/Mishnah');

  if (!res.ok) {
    throw new Error(`Sefaria API error: ${res.status} ${res.statusText}`);
  }

  const raw = (await res.json()) as SefariaShapeEntry[];

  // Group tractates by seder, preserving API order
  const sederMap = new Map<string, SefariaShapeEntry[]>();
  for (const entry of raw) {
    const existing = sederMap.get(entry.section) ?? [];
    existing.push(entry);
    sederMap.set(entry.section, existing);
  }

  const sedarim: Seder[] = [];

  for (const [sederName, entries] of sederMap) {
    const masechtot: Masechet[] = entries.map((entry) => {
      const perakim: Perek[] = entry.chapters.map((count, i) => ({
        perekNumber: i + 1,
        mishnayotCount: count,
      }));

      return {
        nameEn: entry.title.replace(/^Mishnah\s+/, ''), // strip "Mishnah " prefix
        nameHe: entry.heTitle.replace(/^משנה\s+/, ''), // strip "משנה " prefix
        perakimCount: entry.length,
        totalMishnayot: entry.chapters.reduce((sum, n) => sum + n, 0),
        perakim,
      };
    });

    const totalPerakim = masechtot.reduce((s, m) => s + m.perakimCount, 0);
    const totalMishnayot = masechtot.reduce((s, m) => s + m.totalMishnayot, 0);

    sedarim.push({ name: sederName, masechtot, totalPerakim, totalMishnayot });
  }

  const totals = {
    sedarim: sedarim.length,
    masechtot: sedarim.reduce((s, sd) => s + sd.masechtot.length, 0),
    perakim: sedarim.reduce((s, sd) => s + sd.totalPerakim, 0),
    mishnayot: sedarim.reduce((s, sd) => s + sd.totalMishnayot, 0),
  };

  return { sedarim, totals };
}

// ---------------------------------------------------------------------------
// Pretty-print summary
// ---------------------------------------------------------------------------

function printSummary(dataset: MishnahDataset): void {
  console.log('=== MISHNAH DATASET ===\n');

  for (const seder of dataset.sedarim) {
    console.log(
      `📖 ${seder.name}  (${seder.masechtot.length} masechtot | ${seder.totalPerakim} perakim | ${seder.totalMishnayot} mishnayot)`,
    );

    for (const masechet of seder.masechtot) {
      const perekCounts = masechet.perakim
        .map((p) => p.mishnayotCount)
        .join(', ');

      console.log(
        `  ${masechet.nameEn.padEnd(20)} ${masechet.nameHe.padEnd(16)}` +
          `  ${String(masechet.perakimCount).padStart(2)} perakim` +
          `  ${String(masechet.totalMishnayot).padStart(3)} mishnayot` +
          `  [${perekCounts}]`,
      );
    }
    console.log();
  }

  console.log('=== TOTALS ===');
  console.log(`Sedarim:   ${dataset.totals.sedarim}`);
  console.log(`Masechtot: ${dataset.totals.masechtot}`);
  console.log(`Perakim:   ${dataset.totals.perakim}`);
  console.log(`Mishnayot: ${dataset.totals.mishnayot}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dataset = await fetchMishnahDataset();

  printSummary(dataset);

  // Optionally write JSON to disk
  const fs = await import('fs/promises');
  await fs.writeFile(
    'mishnah_dataset.json',
    JSON.stringify(dataset, null, 2),
    'utf-8',
  );
  console.log('\n✓ Written to mishnah_dataset.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
