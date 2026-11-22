"use client";
import { Clock, Info, Store, TriangleAlert, type LucideIcon } from "lucide-react";
import SaveBar from "@/components/panel/form/SaveBar";
import type { PanelForm, PanelFormAction } from "@/components/panel/form/usePanelForm";
import { formatIstanbul } from "@/lib/panel/format";
import { cn } from "@/lib/utils";

export type SettingsSaveResult = { updatedAt: string };
export type SettingsAction = PanelFormAction<SettingsSaveResult>;

/**
 * The editor of one settings document: a <form> with the cards, and the sticky save bar (Ctrl/⌘+S,
 * unsaved-changes guard). The state carries the row's `updatedAt`, which the action checks and returns.
 */
export function SettingsForm<V extends { updatedAt: string | null }>({
  form,
  action,
  prepare,
  children,
}: {
  form: PanelForm<V>;
  action: SettingsAction;
  /** Final touch on the values right before they are sent (and kept as the saved state), e.g. new keys. */
  prepare?: (state: V) => V;
  children: React.ReactNode;
}) {
  const { formRef, state, dirty, pending, errors, reset, submit } = form;
  const savedAt = state.updatedAt ? formatIstanbul(state.updatedAt) : null;
  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} noValidate className="space-y-6 pb-28">
      {children}
      <SaveBar
        dirty={dirty}
        pending={pending}
        errorCount={Object.keys(errors).length}
        onReset={() => reset()}
        savedNote={savedAt ? `Son kayıt: ${savedAt}` : "Henüz kaydedilmedi; varsayılan değerler kullanılıyor."}
        onSave={() =>
          void submit(action, {
            ...(prepare ? { payload: prepare } : {}),
            resetTo: (sent, data) => ({ ...(prepare ? prepare(sent) : sent), updatedAt: data?.updatedAt ?? sent.updatedAt }),
          })
        }
      />
    </form>
  );
}

/** One group of settings: a titled card. */
export function SettingsCard({
  title,
  description,
  aside,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Shown at the end of the header (e.g. a switch or a badge). */
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]", className)}>
      <header className={cn("flex items-start justify-between gap-4 px-5 py-4 sm:px-6", children ? "border-b border-border" : null)}>
        <div className="min-w-0">
          <h3 className="text-[0.9375rem] font-semibold text-text">{title}</h3>
          {description ? <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{description}</p> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </header>
      {children ? <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div> : null}
    </section>
  );
}

const HINT: Record<"info" | "storefront" | "pending" | "warning", { icon: LucideIcon; iconClass: string; box?: string }> = {
  info: { icon: Info, iconClass: "text-gold-text" },
  storefront: { icon: Store, iconClass: "text-gold-text" },
  pending: { icon: Clock, iconClass: "text-text-muted" },
  warning: {
    icon: TriangleAlert,
    iconClass: "text-[#B5730C] dark:text-[#E9B45C]",
    box: "rounded-lg border border-[#D68A12]/35 bg-[#D68A12]/10 px-3 py-2.5 text-text",
  },
};

/**
 * One line that says what a setting does on the site. `storefront`: where it shows; `pending`: stored
 * now, used by a later feature; `warning`: something the admin should fix.
 */
export function Hint({ tone = "info", children, className }: { tone?: keyof typeof HINT; children: React.ReactNode; className?: string }) {
  const { icon: Icon, iconClass, box } = HINT[tone];
  return (
    <p
      role={tone === "warning" ? "status" : undefined}
      className={cn("flex items-start gap-2 text-xs leading-relaxed", box ?? "text-text-muted", className)}
    >
      <Icon aria-hidden className={cn("mt-px size-3.5 shrink-0", iconClass)} strokeWidth={2} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Two-column grid for short fields (one column on phones). */
export function FieldRow({ children, columns = 2, className }: { children: React.ReactNode; columns?: 2 | 3; className?: string }) {
  return (
    <div className={cn("grid gap-x-5 gap-y-5", columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3", className)}>
      {children}
    </div>
  );
}
