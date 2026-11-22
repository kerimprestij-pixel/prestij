"use client";
import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Copy, Megaphone, Palette, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { deleteThemeAction, setDefaultThemeAction } from "@/app/panel/(dashboard)/tema/actions";
import EmptyState from "@/components/panel/EmptyState";
import Badge from "@/components/panel/ui/Badge";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import { buttonClass } from "@/components/panel/ui/styles";
import { toast } from "@/components/panel/ui/toast-store";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { formatIstanbul } from "@/lib/panel/format";
import type { PanelThemeCard, ThemeSwatches } from "@/lib/panel/theme/queries";
import CreateThemeDialog, { type CreateThemeSource } from "./CreateThemeDialog";
import ThemeStatusBadge, { themeStatusInfo } from "./ThemeStatusBadge";

const RADIUS_PX: Record<string, string> = { none: "0px", sm: "4px", md: "8px", lg: "14px", full: "9999px" };

/** Light and dark halves: background, card surface, text lines and the brand/accent colors. */
function SwatchPreview({ swatches, radius }: { swatches: ThemeSwatches; radius: string }) {
  const half = (s: ThemeSwatches["light"], label: string) => (
    <div className="relative flex min-w-0 flex-1 flex-col justify-between gap-3 p-3" style={{ background: s.background }}>
      <span className="sr-only">{label}</span>
      <div className="rounded-md p-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.06)]" style={{ background: s.surface }}>
        <span aria-hidden className="block h-1.5 w-3/4 rounded-full" style={{ background: s.text }} />
        <span aria-hidden className="mt-1.5 block h-1.5 w-1/2 rounded-full opacity-50" style={{ background: s.text }} />
      </div>
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="h-5 flex-1" style={{ background: s.brand, borderRadius: RADIUS_PX[radius] ?? "8px" }} />
        <span aria-hidden className="size-5 shrink-0 rounded-full" style={{ background: s.accent }} />
      </div>
    </div>
  );
  return (
    <div className="flex h-28 overflow-hidden rounded-t-xl border-b border-border">
      {half(swatches.light, "Açık görünüm renkleri")}
      {half(swatches.dark, "Koyu görünüm renkleri")}
    </div>
  );
}

function scheduleText(theme: PanelThemeCard): string | null {
  if (!theme.isScheduled || !theme.startsAt) return null;
  return theme.endsAt ? `${formatIstanbul(theme.startsAt)} – ${formatIstanbul(theme.endsAt)}` : `${formatIstanbul(theme.startsAt)} sonrası`;
}

export default function ThemeList({ themes }: { themes: PanelThemeCard[] }) {
  const [createSource, setCreateSource] = useState<CreateThemeSource | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const live = themes.find((t) => t.status.kind === "live");

  async function run(
    theme: PanelThemeCard,
    action: typeof setDefaultThemeAction,
    options: { title: string; description: string; confirmLabel: string; tone?: "danger" | "default" },
  ) {
    const ok = await confirm({ ...options, tone: options.tone ?? "default" });
    if (!ok) return;
    setBusyId(theme.id);
    try {
      const result = await action(null, toPayloadFormData({ id: theme.id, updatedAt: theme.updatedAt }));
      if (result.ok) toast.success(result.message ?? "Kaydedildi.");
      else
        toast.error(result.error, result.code === "conflict" ? { action: { label: "Sayfayı yenile", onClick: () => location.reload() }, duration: 0 } : undefined);
    } catch {
      toast.error("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-text-muted">
          {live ? (
            <>
              Sitede şu an <span className="font-medium text-text">{live.name}</span> gösteriliyor.{" "}
              <span className="hidden sm:inline">{themeStatusInfo(live.status).detail}</span>
            </>
          ) : (
            "Sitede yerleşik PRESTİJ renkleri gösteriliyor."
          )}
        </p>
        <Button variant="primary" icon={Plus} onClick={() => setCreateSource(null)} className="self-start sm:self-auto">
          Yeni tema
        </Button>
      </div>

      {themes.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={Palette}
            title="Henüz tema yok"
            description="Varsayılan PRESTİJ renkleriyle bir tema oluşturun; renkleri, yazı tiplerini ve zamanlamayı sonra düzenleyebilirsiniz."
            action={
              <Button variant="primary" icon={Plus} onClick={() => setCreateSource(null)}>
                İlk temayı oluştur
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {themes.map((theme) => {
            const schedule = scheduleText(theme);
            const busy = busyId === theme.id;
            return (
              <li key={theme.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]">
                <Link href={`/panel/tema/${theme.id}`} tabIndex={-1} aria-hidden className="block">
                  <SwatchPreview swatches={theme.swatches} radius={theme.radius} />
                </Link>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="min-w-0 space-y-2">
                    <h2 className="truncate font-body text-base font-semibold text-text">
                      <Link
                        href={`/panel/tema/${theme.id}`}
                        className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {theme.name}
                      </Link>
                    </h2>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {theme.isDefault ? (
                        <Badge tone="gold" variant="soft" title="Planlı ya da kampanya teması yokken gösterilen tema">
                          Varsayılan
                        </Badge>
                      ) : null}
                      <ThemeStatusBadge status={theme.status} />
                    </div>
                  </div>
                  {schedule || theme.campaigns.length > 0 ? (
                  <dl className="space-y-1.5 text-xs text-text-muted">
                    {schedule ? (
                      <div className="flex items-start gap-2">
                        <dt className="sr-only">Zamanlama</dt>
                        <CalendarClock aria-hidden className="mt-px size-3.5 shrink-0" />
                        <dd>
                          {schedule}
                          <span className="ms-1.5 whitespace-nowrap">· öncelik {theme.priority}</span>
                        </dd>
                      </div>
                    ) : null}
                    {theme.campaigns.length > 0 ? (
                      <div className="flex items-start gap-2">
                        <dt className="sr-only">Bağlı kampanyalar</dt>
                        <Megaphone aria-hidden className="mt-px size-3.5 shrink-0" />
                        <dd className="min-w-0 truncate">{theme.campaigns.map((c) => c.name).join(", ")}</dd>
                      </div>
                    ) : null}
                  </dl>
                  ) : (
                    <p className="text-xs text-text-muted">{themeStatusInfo(theme.status).detail}</p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                    <Link href={`/panel/tema/${theme.id}`} className={buttonClass("secondary", "sm")}>
                      <Pencil aria-hidden className="size-3.5" />
                      Düzenle
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Copy}
                      onClick={() => setCreateSource({ id: theme.id, name: theme.name })}
                      aria-label={`${theme.name} temasının kopyasını oluştur`}
                    >
                      Kopyala
                    </Button>
                    {!theme.isDefault ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Star}
                          pending={busy}
                          onClick={() =>
                            run(theme, setDefaultThemeAction, {
                              title: `“${theme.name}” varsayılan yapılsın mı?`,
                              description: theme.isScheduled
                                ? "Planlı ya da kampanya teması yokken sitede bu tema gösterilir. Varsayılan tema planlanamadığı için bu temanın zamanlaması kapatılır."
                                : "Planlı ya da kampanya teması yokken sitede bu tema gösterilir.",
                              confirmLabel: "Varsayılan yap",
                            })
                          }
                          aria-label={`${theme.name} temasını varsayılan yap`}
                        >
                          Varsayılan yap
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          disabled={busy}
                          className="ms-auto text-[#B3261E] hover:text-[#B3261E] dark:text-[#F28B82] dark:hover:text-[#F28B82]"
                          onClick={() =>
                            run(theme, deleteThemeAction, {
                              title: `“${theme.name}” silinsin mi?`,
                              description:
                                theme.campaigns.length > 0
                                  ? `Bu tema ${theme.campaigns.length} kampanyaya bağlı; silinince kampanyalar temasız devam eder. Bu işlem geri alınamaz.`
                                  : "Bu işlem geri alınamaz.",
                              confirmLabel: "Temayı sil",
                              tone: "danger",
                            })
                          }
                          aria-label={`${theme.name} temasını sil`}
                        >
                          Sil
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CreateThemeDialog open={createSource !== undefined} onClose={() => setCreateSource(undefined)} source={createSource ?? null} />
      {confirmDialog}
    </>
  );
}
