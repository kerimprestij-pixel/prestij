"use client";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, LoaderCircle, Package, Search, ShoppingBag, type LucideIcon } from "lucide-react";
import { confirmLeaveCurrent } from "@/components/panel/form/dirty-registry";
import { canSeeNavItem, PANEL_NAV } from "@/components/panel/nav-config";
import { SETTINGS_PAGES, settingsHref } from "@/components/panel/settings/settings-pages";
import { hasRole } from "@/lib/panel/roles";
import { foldText } from "@/lib/panel/format";
import { panelSearch, type PanelSearchResult } from "@/lib/panel/search";
import type { StaffRole } from "@/lib/session";
import { cn } from "@/lib/utils";
import Dialog from "./Dialog";
import { isApplePlatform, onOpenCommandPalette } from "./command-palette-store";

type Option = {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
};

const PALETTE_CLASS = "panel-command-palette";
const EMPTY_RESULTS: PanelSearchResult = { products: [], orders: [], pages: [] };
const noopSubscribe = () => () => {};

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere (server render: "Ctrl K"). */
export function useCommandShortcutLabel(): string {
  const apple = useSyncExternalStore(noopSubscribe, isApplePlatform, () => false);
  return apple ? "⌘K" : "Ctrl K";
}

/**
 * Ctrl/⌘+K palette: jump to any panel section the role may open, and search products (name, SKU,
 * barcode), orders (number, e-mail) and pages through panelSearch (role-aware on the server).
 */
export default function CommandPalette({ role }: { role: StaffRole }) {
  const [open, setOpen] = useState(false);

  useEffect(() => onOpenCommandPalette(() => setOpen(true)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A field may use Ctrl/⌘+K itself (the rich text editor's link shortcut prevents the default).
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      // Not on top of another open dialog.
      const otherDialog = Array.from(document.querySelectorAll("dialog[open]")).some((d) => !d.classList.contains(PALETTE_CLASS));
      setOpen((v) => (v ? false : !otherDialog));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Panelde ara" hideHeader placement="top" size="md" className={PALETTE_CLASS} bodyClassName="p-0 sm:p-0">
      {open ? <PaletteBody role={role} onDone={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function PaletteBody({ role, onDone }: { role: StaffRole; onDone: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PanelSearchResult>(EMPTY_RESULTS);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      panelSearch(term)
        .then((r) => {
          if (!alive) return;
          setResults(r);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true))
        .finally(() => alive && setSearching(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term]);

  const options = useMemo<Option[]>(() => {
    const q = foldText(term);
    const nav: Option[] = PANEL_NAV.flatMap((group) =>
      group.items
        .filter((item) => canSeeNavItem(item, role))
        .filter((item) => !q || foldText(`${item.label} ${group.title ?? ""} ${item.summary} ${item.keywords ?? ""}`).includes(q))
        .map((item) => ({
          id: `nav:${item.href}`,
          group: "Git",
          title: item.label,
          subtitle: group.title ?? undefined,
          href: item.href,
          icon: item.icon,
          badge: item.ready || item.href === "/panel" ? undefined : "Yakında",
        })),
    );
    // Settings sub-pages (admin): found by what owners type ("iban", "logo", "whatsapp", …).
    const settings: Option[] =
      q && hasRole(role, "admin")
        ? SETTINGS_PAGES.filter((page) => foldText(`${page.label} ${page.description} ${page.keywords ?? ""}`).includes(q)).map((page) => ({
            id: `settings:${page.slug}`,
            group: "Ayarlar",
            title: page.label,
            subtitle: page.description,
            href: settingsHref(page.slug),
            icon: page.icon,
          }))
        : [];
    const live = term.length >= 2 ? results : EMPTY_RESULTS;
    const hits = (list: PanelSearchResult[keyof PanelSearchResult], group: string, icon: LucideIcon): Option[] =>
      list.map((hit) => ({ id: `${group}:${hit.id}`, group, title: hit.title, subtitle: hit.subtitle, href: hit.href, icon }));
    return [
      ...hits(live.orders, "Siparişler", ShoppingBag),
      ...hits(live.products, "Ürünler", Package),
      ...hits(live.pages, "Sayfalar", FileText),
      ...settings,
      ...(term ? nav.slice(0, 8) : nav),
    ];
  }, [term, results, role]);

  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const activeOption = options[activeIndex];
  const optionId = (index: number) => `${listId}-option-${index}`;
  const activeId = activeOption ? optionId(activeIndex) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const go = (option: Option | undefined) => {
    if (!option) return;
    // router.push skips the SaveBar's link guard: ask here (and discard on "yes").
    if (option.href !== window.location.pathname && !confirmLeaveCurrent()) return;
    onDone();
    router.push(option.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((activeIndex + 1) % Math.max(1, options.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex - 1 + options.length) % Math.max(1, options.length));
    } else if (event.key === "Home" && event.ctrlKey) {
      setActive(0);
    } else if (event.key === "End" && event.ctrlKey) {
      setActive(options.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(activeOption);
    }
  };

  const groups: { name: string; items: { option: Option; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.items.push({ option, index });
    else groups.push({ name: option.group, items: [{ option, index }] });
  });

  const nothing = options.length === 0 && !searching;

  return (
    <div className="flex max-h-[min(70dvh,34rem)] flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4">
        {searching ? (
          <LoaderCircle aria-hidden className="size-4.5 shrink-0 animate-spin text-text-muted motion-reduce:animate-none" />
        ) : (
          <Search aria-hidden className="size-4.5 shrink-0 text-text-muted" />
        )}
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label="Panelde ara"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Sipariş no, e-posta, ürün, SKU veya sayfa…"
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-text placeholder:text-text-muted/70 focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[0.625rem] font-medium text-text-muted sm:inline">Esc</kbd>
      </div>

      <div ref={listRef} id={listId} role="listbox" aria-label="Sonuçlar" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {groups.map((group) => (
          <div key={group.name} role="group" aria-labelledby={`${listId}-${group.name}`} className="mb-1.5 last:mb-0">
            <p id={`${listId}-${group.name}`} className="px-2.5 pb-1 pt-2 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-text-muted">
              {group.name}
            </p>
            {group.items.map(({ option, index }) => {
              const selected = index === activeIndex;
              const Icon = option.icon;
              return (
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => active !== index && setActive(index)}
                  onClick={() => go(option)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm",
                    selected ? "bg-surface-2 text-text" : "text-text",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg border",
                      selected ? "border-gold/40 bg-gold/10 text-gold-text" : "border-border bg-surface text-text-muted",
                    )}
                  >
                    <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.title}</span>
                    {option.subtitle ? <span className="block truncate text-xs text-text-muted">{option.subtitle}</span> : null}
                  </span>
                  {option.badge ? (
                    <span className="shrink-0 rounded-full border border-border px-2 py-px text-[0.625rem] font-medium uppercase tracking-wider text-text-muted">
                      {option.badge}
                    </span>
                  ) : null}
                  {selected ? <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-text-muted" /> : null}
                </div>
              );
            })}
          </div>
        ))}
        {nothing ? (
          <p role="status" className="px-4 py-10 text-center text-sm text-text-muted">
            {failed ? "Arama yapılamadı. Bağlantınızı kontrol edip tekrar deneyin." : `“${term}” için sonuç bulunamadı.`}
          </p>
        ) : null}
        {term.length === 1 ? <p className="px-3 pb-2 pt-1 text-xs text-text-muted">Kayıtlarda aramak için en az 2 karakter yazın.</p> : null}
      </div>

      <div className="hidden shrink-0 items-center gap-4 border-t border-border bg-surface-2/40 px-4 py-2.5 text-[0.6875rem] text-text-muted sm:flex">
        <span>
          <kbd className="font-sans font-semibold">↑↓</kbd> gezin
        </span>
        <span>
          <kbd className="font-sans font-semibold">Enter</kbd> aç
        </span>
        <span>
          <kbd className="font-sans font-semibold">Esc</kbd> kapat
        </span>
        <span aria-live="polite" className="ms-auto">
          {searching ? "Aranıyor…" : term.length >= 2 ? `${options.length} sonuç` : ""}
        </span>
      </div>
    </div>
  );
}
