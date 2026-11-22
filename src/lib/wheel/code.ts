// Gift wheel prize codes: "CARK-" + 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L).
// 31^6 ≈ 887 million codes; uniqueness on upper(code) is still enforced by the database and the
// issuer retries on a collision. Pure apart from the default random source.
import { secureRandomInt, type RandomInt } from "./pick";
import { WHEEL_CODE_ALPHABET, WHEEL_CODE_LENGTH, WHEEL_CODE_PATTERN, WHEEL_CODE_PREFIX } from "./types";

/** A new random prize code, e.g. "CARK-7KQ2MX". */
export function generateWheelCode(randomInt: RandomInt = secureRandomInt): string {
  let body = "";
  for (let i = 0; i < WHEEL_CODE_LENGTH; i++) body += WHEEL_CODE_ALPHABET[randomInt(WHEEL_CODE_ALPHABET.length)];
  return `${WHEEL_CODE_PREFIX}${body}`;
}

/** True for a well-formed prize code (case-insensitive, surrounding spaces ignored). */
export function isWheelCode(value: unknown): boolean {
  return typeof value === "string" && WHEEL_CODE_PATTERN.test(value.trim().toUpperCase());
}
