// robots.txt parsing and matching (RFC 9309: groups, longest match wins, Allow wins a tie, `*` and `$`
// wildcards) plus the robots.txt rules of the audit. Pure.
import { issue, type Issue } from "./types";
import { isForeignLocalUrl, parseAbsolute } from "./url";

export type RobotsRule = { allow: boolean; path: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] };
export type ParsedRobots = {
  groups: RobotsGroup[];
  sitemaps: string[];
  host: string | null;
  /** Lines that are neither blank, comments nor a known directive (1-based line numbers). */
  unknownLines: { line: number; text: string }[];
};

const KNOWN = new Set(["user-agent", "allow", "disallow", "sitemap", "host", "crawl-delay", "clean-param"]);

export function parseRobotsTxt(text: string): ParsedRobots {
  const parsed: ParsedRobots = { groups: [], sitemaps: [], host: null, unknownLines: [] };
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) return;
    const colon = line.indexOf(":");
    const key = colon > 0 ? line.slice(0, colon).trim().toLowerCase() : "";
    const value = colon > 0 ? line.slice(colon + 1).trim() : "";
    if (!KNOWN.has(key)) {
      parsed.unknownLines.push({ line: i + 1, text: rawLine.trim() });
      return;
    }
    switch (key) {
      case "user-agent":
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [] };
          parsed.groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
        return;
      case "allow":
      case "disallow":
        lastWasAgent = false;
        if (!current) {
          parsed.unknownLines.push({ line: i + 1, text: `${rawLine.trim()} (rule before any User-agent)` });
          return;
        }
        // An empty Disallow means "nothing is disallowed": no rule.
        if (value) current.rules.push({ allow: key === "allow", path: value });
        return;
      case "sitemap":
        parsed.sitemaps.push(value);
        return;
      case "host":
        parsed.host = value;
        return;
      default:
        // crawl-delay, clean-param: understood, nothing to evaluate. They do not end the agent lines.
        return;
    }
  });
  return parsed;
}

/** The rules that apply to `agent` (its own groups, else the `*` groups), merged. */
export function rulesFor(robots: ParsedRobots, agent = "*"): RobotsRule[] {
  const token = agent.toLowerCase();
  const own = robots.groups.filter((g) => g.agents.includes(token));
  const groups = own.length > 0 ? own : robots.groups.filter((g) => g.agents.includes("*"));
  return groups.flatMap((g) => g.rules);
}

function patternToRegExp(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** True when `pathAndQuery` ("/tr/urunler?x=1") may be crawled under `rules`. /robots.txt always may. */
export function isAllowed(rules: readonly RobotsRule[], pathAndQuery: string): boolean {
  if (pathAndQuery === "/robots.txt") return true;
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternToRegExp(rule.path).test(pathAndQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow && !best.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/** robots.txt rules: whole-site block, a Sitemap line for this origin, Host, unknown lines. */
export function checkRobots(robots: ParsedRobots, origin: string, robotsUrl: string): Issue[] {
  const issues: Issue[] = [];
  const rules = rulesFor(robots);
  if (!isAllowed(rules, "/")) issues.push(issue("robots-blocks-all", "User-agent * may not crawl \"/\".", robotsUrl));

  const ownSitemaps = robots.sitemaps.filter((s) => parseAbsolute(s)?.origin === origin);
  if (ownSitemaps.length === 0) {
    const listed = robots.sitemaps.length > 0 ? ` (listed: ${robots.sitemaps.join(", ")})` : "";
    issues.push(issue("robots-no-sitemap", `No "Sitemap: ${origin}/…" line${listed}.`, robotsUrl));
  }
  for (const sitemap of robots.sitemaps) {
    if (isForeignLocalUrl(sitemap, origin)) issues.push(issue("foreign-origin-url", `robots.txt Sitemap points to ${sitemap}.`, robotsUrl));
  }

  if (robots.host) {
    const host = robots.host;
    const parsedHost = parseAbsolute(host);
    const matches = parsedHost ? parsedHost.origin === origin : host.toLowerCase() === new URL(origin).host.toLowerCase();
    if (!matches) issues.push(issue("robots-host-mismatch", `Host: ${host} (site origin ${origin}).`, robotsUrl));
  }
  for (const unknown of robots.unknownLines) {
    issues.push(issue("robots-syntax", `Line ${unknown.line}: ${unknown.text}`, robotsUrl));
  }
  return issues;
}
