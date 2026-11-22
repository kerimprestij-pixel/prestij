// Summary and exit code of an SEO audit run. Pure.
import { RULES, type Issue, type RuleCode, type Severity } from "./types";

export type AuditStats = {
  /** URLs requested (pages, sitemaps, feed, robots), assets excluded. */
  fetched: number;
  /** HTML pages that answered 200 and were checked. */
  pages: number;
  /** Pages judged on content (indexable, self-canonical). */
  indexablePages: number;
  /** Same-origin URLs skipped because robots.txt disallows them. */
  blocked: number;
  sitemapUrls: number;
  feedItems: number;
  /** Images checked (og:image, JSON-LD, sitemap, feed). */
  assets: number;
  /** Image URLs on other origins: not fetched (the audit never calls third parties). */
  externalAssetsSkipped: number;
};

export type IssueGroup = { code: RuleCode; severity: Severity; title: string; count: number; issues: Issue[] };

/** Issues grouped by rule code: errors first, then by count (largest first), then by code. */
export function groupIssues(issues: readonly Issue[]): IssueGroup[] {
  const groups = new Map<RuleCode, IssueGroup>();
  for (const i of issues) {
    const group = groups.get(i.code) ?? { code: i.code, severity: i.severity, title: RULES[i.code].title, count: 0, issues: [] };
    group.count += 1;
    group.issues.push(i);
    groups.set(i.code, group);
  }
  return [...groups.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count || a.code.localeCompare(b.code) : a.severity === "error" ? -1 : 1));
}

/** 0 = pass, 1 = errors (or, with --strict, any issue). */
export function exitCodeFor(issues: readonly Issue[], strict: boolean): 0 | 1 {
  return issues.some((i) => strict || i.severity === "error") ? 1 : 0;
}

export type SummaryInput = {
  base: string;
  connect: string | null;
  strict: boolean;
  stats: AuditStats;
  issues: readonly Issue[];
  /** Examples printed per rule (the JSON report has all). */
  examples?: number;
};

/** Human-readable summary for stdout. */
export function formatSummary(input: SummaryInput): string {
  const { stats, issues } = input;
  const examples = input.examples ?? 5;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const lines: string[] = [];
  lines.push(`SEO audit of ${input.base}${input.connect && input.connect !== input.base ? ` (requests sent to ${input.connect})` : ""}`);
  lines.push(
    `Checked ${stats.pages} HTML pages (${stats.indexablePages} indexable), ${stats.fetched} URLs fetched, ${stats.blocked} skipped by robots.txt, ` +
      `${stats.sitemapUrls} sitemap URLs, ${stats.feedItems} feed items, ${stats.assets} images` +
      (stats.externalAssetsSkipped > 0 ? ` (${stats.externalAssetsSkipped} external images not fetched)` : "") +
      ".",
  );
  const groups = groupIssues(issues);
  for (const severity of ["error", "warning"] as const) {
    const ofSeverity = groups.filter((g) => g.severity === severity);
    if (ofSeverity.length === 0) continue;
    const total = ofSeverity.reduce((n, g) => n + g.count, 0);
    lines.push("");
    lines.push(`${severity === "error" ? "ERRORS" : "WARNINGS"}: ${total} in ${ofSeverity.length} rule(s)`);
    for (const group of ofSeverity) {
      lines.push(`  [${severity === "error" ? "x" : "!"}] ${group.code} (${group.count}): ${group.title}`);
      for (const i of group.issues.slice(0, examples)) lines.push(`      ${i.url ? `${i.url}  ` : ""}${i.message}`);
      if (group.issues.length > examples) lines.push(`      … ${group.issues.length - examples} more (see --json)`);
    }
  }
  lines.push("");
  const failed = exitCodeFor(issues, input.strict) === 1;
  lines.push(`Result: ${failed ? "FAIL" : "PASS"} — ${errors} error(s), ${warnings} warning(s)${input.strict ? " (strict: warnings fail too)" : ""}.`);
  return lines.join("\n");
}
