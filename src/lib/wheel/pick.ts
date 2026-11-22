// Gift wheel: the server-side weighted pick (pure apart from the default random source). The result is
// decided here, never in the browser: the browser only animates to the index the server returns.
// `randomInt` is injectable so tests can use a seeded generator (statistical checks) or force a value.
import { randomInt as cryptoRandomInt } from "node:crypto";

/** Uniform integer in [0, maxExclusive). Default: crypto.randomInt (CSPRNG, no modulo bias). */
export type RandomInt = (maxExclusive: number) => number;

export const secureRandomInt: RandomInt = (maxExclusive) => cryptoRandomInt(maxExclusive);

/**
 * Index of the slice that wins, chosen with probability weight / total weight. Weights must be
 * positive integers (the settings schema enforces 1–1000 per slice); anything else is a programming
 * error and throws, so a broken configuration never silently favours one slice.
 */
export function pickWeightedIndex(weights: readonly number[], randomInt: RandomInt = secureRandomInt): number {
  if (weights.length === 0) throw new Error("wheel: no slices to pick from");
  let total = 0;
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 1) throw new Error("wheel: every slice weight must be a positive integer");
    total += w;
  }
  const roll = randomInt(total);
  if (!Number.isInteger(roll) || roll < 0 || roll >= total) throw new Error("wheel: random source out of range");
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll < acc) return i;
  }
  return weights.length - 1; // unreachable: roll < total
}
