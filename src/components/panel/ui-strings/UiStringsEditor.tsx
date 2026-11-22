"use client";
import { memo, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Languages, RotateCcw, Search, SearchX, X } from "lucide-react";
import { resetUiStringAction, saveUiStringsAction } from "@/app/panel/(dashboard)/metinler/actions";
import EmptyState from "@/components/panel/EmptyState";
import { LOCALE_LABELS } from "@/components/panel/form/localized";
import { looselyEqual } from "@/components/panel/form/paths";
import SaveBar from "@/components/panel/form/SaveBar";
import Select from "@/components/panel/form/Select";
import usePanelForm from "@/components/panel/form/usePanelForm";
import Badge from "@/components/panel/ui/Badge";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import { controlClass, errorClass } from "@/components/panel/ui/styles";
import { toast } from "@/components/panel/ui/toast-store";
import type { Locale } from "@/db/schema/common";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { foldText } from "@/lib/panel/format";
import { subgroupLabel, UI_STRING_LOCALES, type UiStringEntry, type UiStringGroup } from "@/lib/panel/ui-strings/catalog";
import { compactOverride, UI_STRING_MAX, uiStringValueErrors, type UiStringOverride } from "@/lib/panel/ui-strings/schemas";
import { describePlaceholders } from "@/lib/panel/ui-strings/template";
import { cn } from "@/lib/utils";

type Overrides = Record<string, UiStringOverride>;
type KeyErrors = Partial<Record<Locale | "key", string>>;

type UiStringsEditorProps = {
  entries: UiStringEntry[];
  groups: UiStringGroup[];
  overrides: Overrides;
  versions: Record<string, string>;
};

const PAGE_SIZE = 40;
const LONG_TEXT = 90;
const CLIENT_INVALID = "Lütfen işaretli metinleri düzeltin.";

const hasOverride = (value: UiStringOverride | undefined) => Object.keys(compactOverride(value)).length > 0;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export default function UiStringsEditor({ entries, groups, overrides, versions: loadedVersions }: UiStringsEditorProps) {
  const form = usePanelForm<Overrides>(overrides, { successMessage: "Metinler kaydedildi." });
  const { formRef, setState, setErrors } = form;
  const { confirm, confirmDialog } = useConfirm();

  // Versions (updatedAt per overridden key): from the page, refreshed by each save's response.
  const [versions, setVersions] = useState(loadedVersions);
  const [seenVersions, setSeenVersions] = useState(loadedVersions);
  if (seenVersions !== loadedVersions) {
    setSeenVersions(loadedVersions);
    setVersions(loadedVersions);
  }

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [group, setGroup] = useState(groups[0]?.key ?? "common");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [sentKeys, setSentKeys] = useState<string[]>([]);
  const sentKeysRef = useRef<string[]>([]);
  const errorsRef = useRef(form.errors);
  useLayoutEffect(() => {
    errorsRef.current = form.errors;
  });
  const [resetting, setResetting] = useState<string | null>(null);

  const haystacks = useMemo(
    () => new Map(entries.map((e) => [e.key, foldText(`${e.key}\n${e.tr}\n${e.en}\n${e.ar}`)])),
    [entries],
  );

  // Errors: live checks while typing + the server's answer ("items.<i>.<locale>" → key).
  const liveErrors = useMemo(() => {
    const out: Record<string, KeyErrors> = {};
    for (const [key, value] of Object.entries(form.state)) {
      const errors = uiStringValueErrors(key, value);
      if (Object.keys(errors).length > 0) out[key] = errors;
    }
    return out;
  }, [form.state]);
  const serverErrors = useMemo(() => {
    const out: Record<string, KeyErrors> = {};
    for (const [path, message] of Object.entries(form.errors)) {
      const match = /^items\.(\d+)\.(tr|en|ar|key)$/.exec(path);
      const key = match ? sentKeys[Number(match[1])] : undefined;
      if (key && match) out[key] = { ...out[key], [match[2]]: message };
    }
    return out;
  }, [form.errors, sentKeys]);

  const changedKeys = useMemo(() => {
    const keys = new Set([...Object.keys(form.state), ...Object.keys(form.saved)]);
    return [...keys].filter((key) => !looselyEqual(compactOverride(form.state[key]), compactOverride(form.saved[key])));
  }, [form.state, form.saved]);
  const changedSet = useMemo(() => new Set(changedKeys), [changedKeys]);
  const overriddenCount = useMemo(() => Object.values(form.saved).filter(hasOverride).length, [form.saved]);
  const errorKeys = useMemo(() => new Set([...Object.keys(liveErrors), ...Object.keys(serverErrors)]), [liveErrors, serverErrors]);

  const groupStats = useMemo(() => {
    const stats = new Map<string, { overridden: number; changed: number }>();
    for (const entry of entries) {
      const s = stats.get(entry.group) ?? { overridden: 0, changed: 0 };
      if (hasOverride(form.saved[entry.key])) s.overridden++;
      if (changedSet.has(entry.key)) s.changed++;
      stats.set(entry.group, s);
    }
    return stats;
  }, [entries, form.saved, changedSet]);

  const folded = foldText(deferredQuery.trim());
  const list = useMemo(
    () =>
      entries.filter((entry) => {
        if (folded) {
          const own = form.state[entry.key];
          const drafts = own ? foldText(`${own.tr ?? ""}\n${own.en ?? ""}\n${own.ar ?? ""}`) : "";
          if (!haystacks.get(entry.key)?.includes(folded) && !drafts.includes(folded)) return false;
        } else if (entry.group !== group) {
          return false;
        }
        return !onlyChanged || hasOverride(form.saved[entry.key]) || changedSet.has(entry.key);
      }),
    [entries, folded, group, onlyChanged, haystacks, form.state, form.saved, changedSet],
  );
  const visible = list.slice(0, limit);

  const onChange = useCallback(
    (key: string, locale: Locale, text: string) => {
      setState((prev) => ({ ...prev, [key]: { ...prev[key], [locale]: text } }));
      const index = sentKeysRef.current.indexOf(key);
      if (index >= 0) {
        const prefix = `items.${index}.`;
        const current = errorsRef.current;
        if (Object.keys(current).some((p) => p.startsWith(prefix))) {
          setErrors(Object.fromEntries(Object.entries(current).filter(([p]) => !p.startsWith(prefix))));
        }
      }
    },
    [setState, setErrors],
  );

  /** Shows the group of `key` (clearing search and filters) so its fields can be focused. */
  const reveal = useCallback(
    (key: string) => {
      const entry = entries.find((e) => e.key === key);
      if (!entry) return;
      const index = entries.filter((e) => e.group === entry.group).findIndex((e) => e.key === key);
      setQuery("");
      setOnlyChanged(false);
      setGroup(entry.group);
      setLimit((n) => Math.max(n, PAGE_SIZE, index + 1));
    },
    [entries],
  );

  async function save() {
    const firstLive = changedKeys.find((key) => liveErrors[key]);
    if (firstLive) {
      toast.error(CLIENT_INVALID);
      reveal(firstLive);
      requestAnimationFrame(() => requestAnimationFrame(() => focusKey(firstLive)));
      return;
    }
    if (changedKeys.length === 0) return;
    const keys = [...changedKeys];
    const items = keys.map((key) => {
      const value = form.state[key] ?? {};
      return { key, value: { tr: value.tr ?? "", en: value.en ?? "", ar: value.ar ?? "" }, updatedAt: versions[key] ?? null };
    });
    sentKeysRef.current = keys;
    setSentKeys(keys);
    await form.submit(saveUiStringsAction, {
      payload: () => ({ items }),
      onSuccess: (data) => {
        if (!data) return;
        setVersions((prev: Record<string, string>) => {
          const next = { ...prev };
          for (const [key, version] of Object.entries(data.versions)) {
            if (version) next[key] = version;
            else delete next[key];
          }
          return next;
        });
      },
      onError: (result) => {
        const first = Object.keys(result.fieldErrors ?? {})
          .map((path) => /^items\.(\d+)\./.exec(path))
          .map((m) => (m ? keys[Number(m[1])] : undefined))
          .find(Boolean);
        if (first) reveal(first);
      },
    });
  }

  const onReset = useCallback(
    async (key: string) => {
      const saved = form.saved[key];
      const version = versions[key];
      if (!hasOverride(saved) || !version) {
        // Only an unsaved draft: drop it.
        setState((prev) => without(prev, key));
        return;
      }
      const ok = await confirm({
        title: "Varsayılan metne dönülsün mü?",
        description: "Bu metin için girdiğiniz özel metin her dilde silinir; sitede yeniden varsayılan metin görünür.",
        confirmLabel: "Varsayılana dön",
        tone: "default",
      });
      if (!ok) return;
      setResetting(key);
      try {
        const result = await resetUiStringAction(null, toPayloadFormData({ key, updatedAt: version }));
        if (result.ok) {
          toast.success(result.message ?? "Varsayılan metne dönüldü.");
          setState((prev) => without(prev, key));
          setVersions((prev) => without(prev, key));
        } else {
          toast.error(result.error, result.code === "conflict" ? { action: { label: "Sayfayı yenile", onClick: () => location.reload() }, duration: 0 } : undefined);
        }
      } catch {
        toast.error("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
      } finally {
        setResetting(null);
      }
    },
    [form.saved, versions, confirm, setState],
  );

  const totalCount = entries.length;
  const groupOptions = groups.map((g) => ({ value: g.key, label: `${g.label} (${g.count})` }));
  const currentGroup = groups.find((g) => g.key === group);

  return (
    <>
      <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="space-y-5 pb-28" noValidate>
        {/* Toolbar */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div role="search" className="relative w-full md:max-w-md">
            <label htmlFor="ui-strings-search" className="sr-only">
              Metinlerde ara
            </label>
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              id="ui-strings-search"
              type="text"
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE_SIZE);
              }}
              placeholder="Metin veya anahtar ara (ör. sepet, header.cart)"
              autoComplete="off"
              className={cn(controlClass, "h-10 ps-9 pe-9")}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute end-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden className="size-4" />
                <span className="sr-only">Aramayı temizle</span>
              </button>
            ) : null}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={onlyChanged}
              onChange={(event) => {
                setOnlyChanged(event.target.checked);
                setLimit(PAGE_SIZE);
              }}
              className="size-4 rounded border-border accent-[var(--brand)]"
            />
            Yalnızca değiştirilenler
            <span className="text-text-muted">({overriddenCount})</span>
          </label>
          <p className="text-xs text-text-muted md:ms-auto">
            {totalCount} metin · {overriddenCount} özel metin
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[14rem_minmax(0,1fr)]">
          {/* Groups: list on wide screens, select below */}
          <nav aria-label="Metin grupları" className={cn("hidden xl:block", folded && "opacity-60")}>
            <ul className="sticky top-20 max-h-[calc(100dvh-6rem)] space-y-0.5 overflow-y-auto pe-1">
              {groups.map((g) => {
                const stats = groupStats.get(g.key);
                const current = !folded && g.key === group;
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setGroup(g.key);
                        setQuery("");
                        setLimit(PAGE_SIZE);
                      }}
                      aria-current={current ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                        current ? "bg-brand font-medium text-brand-contrast" : "text-text-muted hover:bg-surface-2 hover:text-text",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{g.label}</span>
                      {stats?.changed ? <span aria-label="kaydedilmemiş değişiklik" className="size-1.5 shrink-0 rounded-full bg-[#D68A12]" /> : null}
                      <span className={cn("text-xs tabular-nums", current ? "text-brand-contrast/80" : "text-text-muted")}>
                        {stats?.overridden ? `${stats.overridden}/` : ""}
                        {g.count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0 space-y-4">
            <div className="xl:hidden">
              <label htmlFor="ui-strings-group" className="sr-only">
                Metin grubu
              </label>
              <Select
                id="ui-strings-group"
                value={group}
                onChange={(v) => {
                  setGroup(v);
                  setQuery("");
                  setLimit(PAGE_SIZE);
                }}
                options={groupOptions}
              />
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-heading text-2xl text-text">{folded ? "Arama sonuçları" : (currentGroup?.label ?? group)}</h2>
              <p className="text-xs text-text-muted" aria-live="polite">
                {list.length} metin
              </p>
            </div>

            {visible.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface">
                <EmptyState
                  icon={folded ? SearchX : Languages}
                  title={folded ? "Eşleşen metin yok" : "Bu grupta değiştirilen metin yok"}
                  description={
                    folded
                      ? "Farklı bir kelime deneyin; anahtar (ör. header.cart) ya da Türkçe, İngilizce veya Arapça metinle arayabilirsiniz."
                      : "Filtreyi kapatıp gruptaki tüm metinleri görebilirsiniz."
                  }
                  action={
                    <Button
                      onClick={() => {
                        setQuery("");
                        setOnlyChanged(false);
                      }}
                    >
                      Tüm metinleri göster
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className="space-y-3">
                {visible.map((entry, index) => {
                  const heading = !folded && entry.subgroup !== (visible[index - 1]?.subgroup ?? null) ? entry.subgroup : null;
                  return (
                    <UiStringRow
                      key={entry.key}
                      entry={entry}
                      heading={heading ? subgroupLabel(heading) : null}
                      value={form.state[entry.key]}
                      overridden={hasOverride(form.saved[entry.key])}
                      changed={changedSet.has(entry.key)}
                      errors={errorKeys.has(entry.key) ? { ...serverErrors[entry.key], ...liveErrors[entry.key] } : undefined}
                      resetting={resetting === entry.key}
                      onChange={onChange}
                      onReset={onReset}
                    />
                  );
                })}
              </ul>
            )}

            {list.length > visible.length ? (
              <div className="flex justify-center pt-2">
                <Button onClick={() => setLimit((n) => n + PAGE_SIZE)}>Daha fazla göster ({list.length - visible.length})</Button>
              </div>
            ) : null}
          </div>
        </div>

        <SaveBar
          dirty={form.dirty}
          pending={form.pending}
          onSave={() => void save()}
          onReset={() => form.reset()}
          saveLabel={changedKeys.length > 1 ? `${changedKeys.length} metni kaydet` : "Kaydet"}
          errorCount={errorKeys.size}
          savedNote="Boş bıraktığınız dillerde varsayılan metin kullanılır."
        />
      </form>
      {confirmDialog}
    </>
  );
}

function focusKey(key: string) {
  const el = document.querySelector<HTMLElement>(`[data-ui-key="${CSS.escape(key)}"] [aria-invalid="true"]`);
  if (el) {
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }
}

type UiStringRowProps = {
  entry: UiStringEntry;
  heading: string | null;
  value: UiStringOverride | undefined;
  overridden: boolean;
  changed: boolean;
  errors: KeyErrors | undefined;
  resetting: boolean;
  onChange: (key: string, locale: Locale, text: string) => void;
  onReset: (key: string) => void;
};

const UiStringRow = memo(function UiStringRow({ entry, heading, value, overridden, changed, errors, resetting, onChange, onReset }: UiStringRowProps) {
  // Union over the three languages (the variable names are the same; only plural syntax differs).
  const placeholders = [...new Set([entry.tr, entry.en, entry.ar].flatMap((text) => describePlaceholders(text).map((p) => p.name)))];
  const domId = `ui-${entry.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <>
      {heading ? <li className="px-1 pt-3 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">{heading}</li> : null}
      <li
        data-ui-key={entry.key}
        className={cn(
          "rounded-xl border bg-surface p-4 shadow-[0_1px_2px_rgb(3_38_95/0.04)]",
          errors ? "border-[#B3261E]/40 dark:border-[#F28B82]/40" : changed ? "border-[#D68A12]/45" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <code className="min-w-0 break-all font-mono text-xs text-text-muted">{entry.key}</code>
          {placeholders.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1" title="Bu yer tutucular metinde aynen kalmalı; site onları gerçek değerlerle doldurur.">
              {placeholders.map((name) => (
                <span key={name} className="rounded border border-border bg-surface-2 px-1.5 py-px font-mono text-[0.6875rem] text-text">
                  {`{${name}}`}
                </span>
              ))}
            </span>
          ) : null}
          <span className="ms-auto flex items-center gap-2">
            {changed ? (
              <Badge tone="warning" size="sm">
                Kaydedilmedi
              </Badge>
            ) : overridden ? (
              <Badge tone="gold" size="sm">
                Özel metin
              </Badge>
            ) : null}
            {overridden || changed ? (
              <Button size="sm" variant="ghost" icon={RotateCcw} pending={resetting} onClick={() => onReset(entry.key)}>
                Varsayılana dön
              </Button>
            ) : null}
          </span>
        </div>
        {errors?.key ? <p className={cn(errorClass, "mt-2")}>{errors.key}</p> : null}

        <div className="mt-3 divide-y divide-border">
          {UI_STRING_LOCALES.map((locale) => {
            const meta = LOCALE_LABELS[locale];
            const id = `${domId}-${locale}`;
            const error = errors?.[locale];
            const text = value?.[locale] ?? "";
            const long = entry[locale].length > LONG_TEXT || text.length > LONG_TEXT;
            const common = {
              id,
              value: text,
              lang: meta.lang,
              dir: meta.dir,
              maxLength: UI_STRING_MAX,
              placeholder: "Varsayılan kullanılıyor",
              "aria-invalid": error ? true : undefined,
              "aria-describedby": `${id}-default${error ? ` ${id}-error` : ""}`,
              spellCheck: true,
              autoComplete: "off",
            } as const;
            return (
              <div key={locale} className="grid gap-x-4 gap-y-1.5 py-2.5 first:pt-0 last:pb-0 md:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
                <label htmlFor={id} className="pt-0.5 text-xs font-semibold text-text md:pt-2.5">
                  <span aria-hidden>{meta.short}</span>
                  <span className="sr-only">{meta.name} özel metin</span>
                </label>
                <p id={`${id}-default`} lang={meta.lang} dir={meta.dir} className="min-w-0 break-words text-sm leading-relaxed text-text-muted md:pt-2">
                  <span className="sr-only">Varsayılan: </span>
                  {entry[locale]}
                </p>
                <div className="min-w-0 space-y-1">
                  {long ? (
                    <textarea
                      {...common}
                      rows={3}
                      onChange={(event) => onChange(entry.key, locale, event.target.value)}
                      className={cn(controlClass, "block min-h-20 resize-y px-3 py-2 leading-relaxed")}
                    />
                  ) : (
                    <input {...common} type="text" onChange={(event) => onChange(entry.key, locale, event.target.value)} className={cn(controlClass, "h-10 px-3")} />
                  )}
                  {error ? (
                    <p id={`${id}-error`} className={errorClass}>
                      {error}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </li>
    </>
  );
});
