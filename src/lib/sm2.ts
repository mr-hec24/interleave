export interface Sm2State {
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
}

export const SM2_DEFAULTS: Sm2State = {
  repetitions: 0,
  easeFactor: 2.5,
  intervalDays: 0,
};

export function applySm2(state: Sm2State, quality: number): Sm2State {
  if (quality < 0 || quality > 5 || !Number.isInteger(quality)) {
    throw new Error(`quality must be an integer 0–5, got ${quality}`);
  }

  let { repetitions, easeFactor, intervalDays } = state;

  if (quality >= 3) {
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitions += 1;
  } else {
    repetitions = 0;
    intervalDays = 1;
  }

  easeFactor += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  if (easeFactor < 1.3) {
    easeFactor = 1.3;
  }

  return {
    repetitions,
    easeFactor: Math.round(easeFactor * 100) / 100,
    intervalDays,
  };
}
