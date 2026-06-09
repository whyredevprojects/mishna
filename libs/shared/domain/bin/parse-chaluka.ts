import { mishnahDataset, createMishnaStructure } from '../src/lib/mishna-structure-factory';
import { Masechet } from '../src/lib/mishna-types';
import { BlockRange } from '../src/lib/types';

/**
 * Parses chaluka.csv into the bundled chaluka.json artifact.
 *
 * chaluka.csv has three integer columns: `maseches code, Perek, chelek number`.
 *   - maseches code  → 1-based index into the dataset's masechtot (1 = Berakhot).
 *   - Perek          → perek number within that mesechta.
 *   - chelek number  → the "lot" (1..118, sequential in corpus order) that perek
 *                      belongs to.
 *
 * Each chelek lives entirely within one mesechta and covers a contiguous run of
 * perakim, so it maps to a single contiguous BlockRange of mishnayot. This tool
 * resolves each maseches code to its English nameEn, computes each lot's range,
 * validates that the lots tile the whole corpus, and writes chaluka.json.
 *
 * Run:  npx tsx libs/shared/domain/bin/parse-chaluka.ts
 */

// ---------------------------------------------------------------------------
// Output shape (mirrors src/lib/mishna-chalakim.ts ChalukaEntry)
// ---------------------------------------------------------------------------

interface ChalukaEntry {
  lot: number;
  mesechta: string;
  range: BlockRange;
}

interface CsvRow {
  masechesCode: number;
  perek: number;
  chelek: number;
}

// ---------------------------------------------------------------------------
// Parse + transform
// ---------------------------------------------------------------------------

/** Splits the trivial 3-integer-column CSV. Drops the header and blank lines. */
function parseCsv(text: string): CsvRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(1) // drop header row
    .map((line) => {
      const [masechesCode, perek, chelek] = line.split(',').map(Number);
      return { masechesCode, perek, chelek };
    });
}

function buildChaluka(rows: CsvRow[]): ChalukaEntry[] {
  // Flat masechtot list in dataset order; maseches code N -> masechtot[N - 1].
  const masechtot: Masechet[] = mishnahDataset.sedarim.flatMap((s) => s.masechtot);

  // Group rows by chelek, preserving first-seen order.
  const lots = new Map<number, CsvRow[]>();
  for (const row of rows) {
    const existing = lots.get(row.chelek) ?? [];
    existing.push(row);
    lots.set(row.chelek, existing);
  }

  const entries: ChalukaEntry[] = [];

  for (const [lot, lotRows] of lots) {
    const code = lotRows[0].masechesCode;
    const masechet = masechtot[code - 1];
    if (!masechet) {
      throw new Error(`chaluka.csv: unknown maseches code ${code} (lot ${lot})`);
    }
    if (lotRows.some((r) => r.masechesCode !== code)) {
      throw new Error(`chaluka.csv: lot ${lot} spans more than one mesechta`);
    }

    const firstPerek = Math.min(...lotRows.map((r) => r.perek));
    const lastPerek = Math.max(...lotRows.map((r) => r.perek));
    const lastPerekData = masechet.perakim[lastPerek - 1];
    if (!lastPerekData) {
      throw new Error(
        `chaluka.csv: lot ${lot} references perek ${lastPerek} missing from ${masechet.nameEn}`,
      );
    }

    entries.push({
      lot,
      mesechta: masechet.nameEn,
      range: {
        start: { mesechta: masechet.nameEn, perek: firstPerek, mishna: 1 },
        end: {
          mesechta: masechet.nameEn,
          perek: lastPerek,
          mishna: lastPerekData.mishnayotCount,
        },
      },
    });
  }

  return entries.sort((a, b) => a.lot - b.lot);
}

// ---------------------------------------------------------------------------
// Validation — lots must tile the whole corpus, in order, with no gaps/overlap
// ---------------------------------------------------------------------------

function validate(entries: ChalukaEntry[]): void {
  const structure = createMishnaStructure();

  let covered = 0;
  let prevEndIdx = -1;
  entries.forEach((entry, i) => {
    if (entry.lot !== i + 1) {
      throw new Error(`Lots not sequential: position ${i} has lot ${entry.lot}`);
    }
    const startIdx = structure.indexOf(entry.range.start);
    if (startIdx !== prevEndIdx + 1) {
      throw new Error(
        `Lot ${entry.lot} starts at index ${startIdx}, expected ${prevEndIdx + 1} (gap or overlap)`,
      );
    }
    prevEndIdx = structure.indexOf(entry.range.end);
    covered += structure.rangeSize(entry.range);
  });

  if (structure.indexOf(entries[0].range.start) !== 0) {
    throw new Error('First lot does not start at the first mishna of the corpus');
  }
  const lastEnd = entries[entries.length - 1].range.end;
  if (!structure.isLast(lastEnd)) {
    throw new Error('Last lot does not end at the last mishna of the corpus');
  }
  if (covered !== structure.totalMishnayot) {
    throw new Error(
      `Lots cover ${covered} mishnayot, expected ${structure.totalMishnayot}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const url = await import('url');
  const dir = path.dirname(url.fileURLToPath(import.meta.url));

  const csv = await fs.readFile(
    path.join(dir, '../src/data/chaluka.csv'),
    'utf-8',
  );
  const entries = buildChaluka(parseCsv(csv));
  validate(entries);

  const outPath = path.join(dir, '../src/data/chaluka.json');
  await fs.writeFile(outPath, JSON.stringify(entries, null, 2), 'utf-8');

  const totalMishnayot = createMishnaStructure().totalMishnayot;
  console.log(`✓ ${entries.length} lots covering ${totalMishnayot} mishnayot`);
  console.log(`✓ Written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
