// Hediye Çarkı mutations other than the settings save (which is the generic settings action with
// minRole "editor"). No Next APIs: DB tests call these with a transaction.
import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import type { AuditEntry } from "@/lib/panel/audit";
import { PanelError } from "@/lib/panel/errors";
import type { SettingsInput } from "@/lib/panel/settings/schemas";
import { readSettingsRow, saveSettings } from "@/lib/panel/settings/service";
import type { Tx } from "@/lib/panel/tx";
import { WHEEL_LIMITS } from "@/lib/settings/types";

export const ROUND_CHANGED_MESSAGE = "Tur bu arada başka biri tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.";
export const ROUND_LIMIT_MESSAGE = "Tur numarası en yüksek değere ulaştı; yeni tur başlatılamaz.";

export type StartRoundInput = {
  /** The settings stamp the page loaded (null: the key had no row yet). */
  updatedAt: Date | null;
  /** The round the page showed (guards against two people pressing the button). */
  round: number;
};

/**
 * "Yeni tur başlat": round + 1, so every visitor may spin again and every account may win one more prize
 * (contract §1.1). Prizes already issued keep their own expiry. Locks the settings row, refuses a stale
 * page (round or stamp changed meanwhile), saves through saveSettings (storefront re-validation, audit).
 */
export async function startNewWheelRound(tx: Tx, input: StartRoundInput): Promise<{ round: number; updatedAt: Date; audit: AuditEntry }> {
  const s = schema.settings;
  await tx.select({ key: s.key }).from(s).where(eq(s.key, "giftWheel")).for("update");
  const current = await readSettingsRow("giftWheel", tx);
  if (current.value.round !== input.round) throw new PanelError("conflict", ROUND_CHANGED_MESSAGE);
  if (current.value.round >= WHEEL_LIMITS.round.max) throw new PanelError("invalid", ROUND_LIMIT_MESSAGE);
  const round = current.value.round + 1;
  // The panel input shape lists every text key (undefined = dictionary default), like a form save.
  const { title, subtitle, teaser, claimCta, registerCta, signInCta } = current.value.texts;
  const value: SettingsInput<"giftWheel"> = { ...current.value, round, texts: { title, subtitle, teaser, claimCta, registerCta, signInCta } };
  const saved = await saveSettings(tx, "giftWheel", { value, updatedAt: input.updatedAt });
  return { round, updatedAt: saved.updatedAt, audit: { ...saved.audit, action: "wheel_round" } };
}
