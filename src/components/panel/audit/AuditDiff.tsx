// Before/after table for one audit row: changed fields highlighted (gold edge, old value struck through),
// added fields in green, removed in red, unchanged fields muted at the end. Server component (no state).
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import { cn } from "@/lib/utils";
import { diffAudit, enumValueLabel, isIsoDateString, isLocalizedValue, isNestedValue, leafChanges, type DiffKind, type DiffRow } from "./labels";

const KIND_LABEL: Record<DiffKind, string> = {
  added: "Eklendi",
  removed: "Kaldırıldı",
  changed: "Değişti",
  same: "Değişmedi",
};

export default function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const rows = diffAudit(before, after);
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-sm text-text-muted">Bu kayıtta alan ayrıntısı yok.</p>;
  }
  const showBefore = rows.some((r) => r.kind !== "added");
  const showAfter = rows.some((r) => r.kind !== "removed");
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] table-fixed text-sm">
        <caption className="sr-only">Alan değişiklikleri</caption>
        <colgroup>
          <col className="w-[28%]" />
          {showBefore ? <col /> : null}
          {showAfter ? <col /> : null}
        </colgroup>
        <thead>
          <tr className="border-b border-border text-start text-[0.6875rem] uppercase tracking-[0.12em] text-text-muted">
            <th scope="col" className="px-4 py-2 text-start font-medium">Alan</th>
            {showBefore ? <th scope="col" className="px-4 py-2 text-start font-medium">Önce</th> : null}
            {showAfter ? <th scope="col" className="px-4 py-2 text-start font-medium">Sonra</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <DiffLine key={row.key} row={row} showBefore={showBefore} showAfter={showAfter} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffLine({ row, showBefore, showAfter }: { row: DiffRow; showBefore: boolean; showAfter: boolean }) {
  const same = row.kind === "same";
  return (
    <tr
      className={cn(
        "border-b border-border align-top last:border-b-0",
        row.kind === "changed" && "bg-gold/[0.07]",
        row.kind === "added" && "bg-[#2F8F5B]/[0.06]",
        row.kind === "removed" && "bg-[#C2413A]/[0.06]",
      )}
    >
      <th
        scope="row"
        className={cn(
          "border-s-2 px-4 py-2.5 text-start font-medium",
          row.kind === "changed" ? "border-gold" : row.kind === "added" ? "border-[#2F8F5B]" : row.kind === "removed" ? "border-[#C2413A]" : "border-transparent",
          same ? "text-text-muted" : "text-text",
        )}
      >
        <span className="block break-words">{row.label}</span>
        <span className="mt-0.5 block text-[0.6875rem] font-normal text-text-muted">
          {row.label !== row.key ? <code className="font-mono">{row.key}</code> : null}
          <span className="sr-only">, {KIND_LABEL[row.kind]}</span>
        </span>
      </th>
      {row.kind === "changed" && isNestedValue(row.before) && isNestedValue(row.after) ? (
        // Nested values (menu items, section content…): only the leaves that changed, not two JSON blobs.
        <td colSpan={(showBefore ? 1 : 0) + (showAfter ? 1 : 0)} className="px-4 py-2.5 text-text">
          <NestedChanges before={row.before} after={row.after} />
        </td>
      ) : null}
      {row.kind === "changed" && isNestedValue(row.before) && isNestedValue(row.after) ? null : showBefore ? (
        <td className={cn("px-4 py-2.5", same ? "text-text-muted" : "text-text", row.kind === "changed" && "text-text-muted")}>
          {row.kind === "added" ? (
            <Empty />
          ) : (
            <AuditValue value={row.before} label={enumValueLabel(row.key, row.before)} struck={row.kind === "changed" || row.kind === "removed"} />
          )}
        </td>
      ) : null}
      {row.kind === "changed" && isNestedValue(row.before) && isNestedValue(row.after) ? null : showAfter ? (
        <td className={cn("px-4 py-2.5", same ? "text-text-muted" : "text-text")}>
          {row.kind === "removed" ? <Empty /> : <AuditValue value={row.after} label={enumValueLabel(row.key, row.after)} />}
        </td>
      ) : null}
    </tr>
  );
}

function NestedChanges({ before, after }: { before: unknown; after: unknown }) {
  const { changes, more } = leafChanges(before, after);
  return (
    <ul className="space-y-2">
      {changes.map((change, i) => (
        <li key={i} className="grid gap-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-3">
          <span className="text-xs font-medium text-text-muted">{change.path}</span>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            {change.before === undefined ? null : (
              <span className="text-text-muted">
                <AuditValue value={change.before} struck />
              </span>
            )}
            {change.before !== undefined && change.after !== undefined ? <span aria-hidden className="text-text-muted">→</span> : null}
            {change.after === undefined ? (
              <span className="text-xs text-text-muted">(kaldırıldı)</span>
            ) : (
              <AuditValue value={change.after} />
            )}
            {change.before === undefined ? <span className="text-xs text-text-muted">(eklendi)</span> : null}
          </span>
        </li>
      ))}
      {more > 0 ? <li className="text-xs text-text-muted">ve {more} değişiklik daha</li> : null}
    </ul>
  );
}

function Empty() {
  return (
    <span className="text-text-muted" aria-label="boş">
      —
    </span>
  );
}

const LONG_TEXT = 280;

/** Readable rendering of a stored JSON value. */
export function AuditValue({ value, label, struck = false }: { value: unknown; label?: string | null; struck?: boolean }) {
  const strike = struck ? "line-through decoration-text-muted/60" : undefined;
  if (value === null || value === undefined || value === "") return <Empty />;
  if (label) {
    return (
      <span className={strike} title={typeof value === "string" ? value : undefined}>
        {label}
      </span>
    );
  }
  if (typeof value === "boolean") return <span className={strike}>{value ? "Evet" : "Hayır"}</span>;
  if (typeof value === "number") return <span className={cn("tabular-nums", strike)}>{formatNumber(value)}</span>;
  if (isIsoDateString(value)) return <time dateTime={value} className={strike}>{formatDateTime(value)}</time>;
  if (typeof value === "string") return <LongText text={value} className={strike} />;
  if (isLocalizedValue(value)) {
    return (
      <dl className={cn("space-y-1", strike)}>
        {(["tr", "en", "ar"] as const).map((locale) =>
          value[locale] ? (
            <div key={locale} className="flex gap-2">
              <dt className="w-6 shrink-0 pt-px text-[0.6875rem] font-medium uppercase text-text-muted">{locale}</dt>
              <dd className="min-w-0 flex-1" dir={locale === "ar" ? "rtl" : undefined} lang={locale}>
                <LongText text={value[locale] ?? ""} />
              </dd>
            </div>
          ) : null,
        )}
      </dl>
    );
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number") && value.length <= 20) {
    return <span className={cn("break-words", strike)}>{value.length ? value.join(", ") : <Empty />}</span>;
  }
  return (
    <pre className={cn("max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2/70 p-2 font-mono text-xs leading-relaxed", strike)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function LongText({ text, className }: { text: string; className?: string }) {
  if (text.length <= LONG_TEXT) return <span className={cn("whitespace-pre-wrap break-words", className)}>{text}</span>;
  return (
    <details className={cn("group", className)}>
      <summary className="cursor-pointer list-none whitespace-pre-wrap break-words [&::-webkit-details-marker]:hidden">
        {text.slice(0, LONG_TEXT)}
        <span className="group-open:hidden">
          …{" "}
          <span className="text-xs font-medium text-text underline underline-offset-4">Tamamını göster</span>
        </span>
      </summary>
      <span className="whitespace-pre-wrap break-words">{text.slice(LONG_TEXT)}</span>
    </details>
  );
}
