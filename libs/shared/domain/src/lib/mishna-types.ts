// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Perek {
  perekNumber: number;
  mishnayotCount: number;
}

export interface Masechet {
  nameEn: string;
  nameHe: string;
  perakimCount: number;
  totalMishnayot: number;
  perakim: Perek[];
}

export interface Seder {
  name: string;
  masechtot: Masechet[];
  totalPerakim: number;
  totalMishnayot: number;
}

export interface MishnahDataset {
  sedarim: Seder[];
  totals: {
    sedarim: number;
    masechtot: number;
    perakim: number;
    mishnayot: number;
  };
}
