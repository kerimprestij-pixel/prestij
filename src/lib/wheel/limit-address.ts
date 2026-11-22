// The address the gift wheel's per-IP limits count (lead decision D13; pure: unit-tested). Used only by
// the wheel's limit keys (./limits.ts: wheel:ip and wheel-claim:ip); every other area's per-IP limit
// keeps the plain client IP, and the spin row's salted IP hash still uses the full address.
//   IPv6                      → its /64 prefix: a home connection or a phone usually gets a whole /64 and
//                               can pick a new address inside it at will, so one address per key would let
//                               one visitor spin again and again;
//   IPv4-mapped IPv6          → the IPv4 address (::ffff:203.0.113.7 is the same visitor as 203.0.113.7);
//   IPv4 and anything else    → unchanged.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

/** "1.2.3.4" → its two 16-bit groups, or null when it is not a dotted quad of 0–255 parts. */
function ipv4Groups(text: string): [number, number] | null {
  const m = IPV4.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return [(parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]];
}

/** The eight 16-bit groups of an IPv6 address ("::" and an embedded IPv4 tail allowed), or null when it is not one. */
function ipv6Groups(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string, last: boolean): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const pieces = part.split(":");
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (last && i === pieces.length - 1 && piece.includes(".")) {
        const tail = ipv4Groups(piece);
        if (!tail) return null;
        out.push(...tail);
      } else if (HEXTET.test(piece)) {
        out.push(parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  if (halves.length === 1) {
    const all = parse(halves[0], true);
    return all && all.length === 8 ? all : null;
  }
  const head = parse(halves[0], false);
  const tail = parse(halves[1], true);
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null; // "::" stands for at least one zero group
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * The address a wheel limit key uses for `ip` (the trusted client IP of src/lib/rate-limit.ts clientIpFrom):
 * - IPv6 → its /64 prefix in canonical lower-case hex, e.g. "2001:db8:a:b::/64" (brackets, a port after
 *   them and a zone id such as "%eth0" are ignored);
 * - IPv4-mapped IPv6 ("::ffff:203.0.113.7", also written "::ffff:cb00:7107") → "203.0.113.7";
 * - IPv4, and anything that is not an IPv6 address ("unknown", ""), → unchanged (trimmed).
 */
export function wheelLimitAddress(ip: string): string {
  const raw = (ip ?? "").trim();
  if (!raw.includes(":")) return raw;
  let text = raw.toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
  if (bracketed) text = bracketed[1];
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const groups = ipv6Groups(text);
  if (!groups) return raw;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}
