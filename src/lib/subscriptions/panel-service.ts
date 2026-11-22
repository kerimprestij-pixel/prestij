// Panel services of subscriptions (no Next APIs; DB tests call them with a transaction):
// pause / resume / cancel on behalf of a customer (editor) and plan CRUD (admin).
import "server-only";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import type { AuditEntry } from "@/lib/panel/audit";
import { auditChanges } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { PanelError } from "@/lib/panel/errors";
import { idInput, localizedTextOf, percentInputRange, updatedAtInput } from "@/lib/panel/schemas";
import type { Tx } from "@/lib/panel/tx";
import { changeSubscription } from "./service";

const subs = schema.subscriptions;
const plans = schema.subscriptionPlans;

// ---------------------------------------------------------------------------------------------
// Subscriptions

export const staffChangeSchema = z.object({
  id: idInput,
  kind: z.enum(["pause", "resume", "cancel"], { error: "Geçersiz işlem." }),
  updatedAt: updatedAtInput,
});
export type StaffChangeInput = z.output<typeof staffChangeSchema>;

const STAFF_MESSAGES = { pause: "Abonelik duraklatıldı", resume: "Abonelik yeniden başlatıldı", cancel: "Abonelik iptal edildi" } as const;

/** Pause, resume or cancel a customer's subscription (locked by updatedAt; the customer gets an e-mail). */
export async function staffChangeSubscription(
  tx: Tx,
  input: StaffChangeInput,
  actor: { userId: string; role: "staff" | "editor" | "admin" },
): Promise<{ message: string; updatedAt: Date; audit: AuditEntry }> {
  const [row] = await tx.select({ id: subs.id, updatedAt: subs.updatedAt }).from(subs).where(eq(subs.id, input.id)).for("update").limit(1);
  if (!row) throw new PanelError("not_found", "Abonelik bulunamadı.");
  assertFresh(row.updatedAt, input.updatedAt);
  const result = await changeSubscription(tx, { subscriptionId: input.id, change: { kind: input.kind } }, { type: "staff", ...actor });
  if (!result.ok) {
    if (result.code === "not_found") throw new PanelError("not_found", "Abonelik bulunamadı.");
    throw new PanelError("conflict", "Bu işlem aboneliğin şu anki durumunda yapılamaz. Sayfayı yenileyin.");
  }
  const [saved] = await tx.select({ updatedAt: subs.updatedAt }).from(subs).where(eq(subs.id, input.id)).limit(1);
  return {
    message: `${STAFF_MESSAGES[input.kind]}${result.mailQueued ? "; müşteriye e-posta gönderildi." : ". (Abonelik değişikliği e-postası kapalı olduğu için müşteriye e-posta gönderilmedi.)"}`,
    updatedAt: saved.updatedAt,
    audit: { action: "status", entity: "subscription", entityId: input.id, before: result.before, after: result.after },
  };
}

// ---------------------------------------------------------------------------------------------
// Plans

const planFields = {
  name: localizedTextOf({ max: 60, requiredMessage: "Plan adını Türkçe girin (ör. Her ay)." }),
  interval: z.enum(["week", "month"], { error: "Hafta veya ay seçin." }),
  intervalCount: z.coerce
    .number({ error: "Sıklık bir sayı olmalı." })
    .int("Sıklık tam sayı olmalı.")
    .min(1, "Sıklık en az 1 olmalı.")
    .max(12, "Sıklık en fazla 12 olabilir."),
  discountPercent: percentInputRange(0, 50),
  isActive: z.boolean(),
  position: z.coerce.number().int().min(0).max(999).default(0),
};

export const planCreateSchema = z.object(planFields);
export const planUpdateSchema = z.object({ id: idInput, updatedAt: updatedAtInput, ...planFields });
export const planDeleteSchema = z.object({ id: idInput, updatedAt: updatedAtInput });

type PlanInput = z.output<typeof planCreateSchema>;

const planValues = (input: PlanInput) => ({
  name: input.name,
  interval: input.interval,
  intervalCount: input.intervalCount,
  discountPercent: input.discountPercent,
  isActive: input.isActive,
  position: input.position,
});

export async function createPlan(tx: Tx, input: PlanInput): Promise<{ id: number; updatedAt: Date; audit: AuditEntry }> {
  const [row] = await tx.insert(plans).values(planValues(input)).returning();
  return { id: row.id, updatedAt: row.updatedAt, audit: { action: "create", entity: "subscription_plan", entityId: row.id, after: planValues(input) } };
}

export async function updatePlan(tx: Tx, input: z.output<typeof planUpdateSchema>): Promise<{ id: number; updatedAt: Date; audit: AuditEntry }> {
  const [row] = await tx.select().from(plans).where(eq(plans.id, input.id)).for("update").limit(1);
  if (!row) throw new PanelError("not_found", "Plan bulunamadı.");
  assertFresh(row.updatedAt, input.updatedAt);
  const next = planValues(input);
  const [saved] = await tx
    .update(plans)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(plans.id, input.id))
    .returning({ updatedAt: plans.updatedAt });
  return { id: row.id, updatedAt: saved.updatedAt, audit: { action: "update", entity: "subscription_plan", entityId: row.id, ...auditChanges(row, { ...row, ...next }) } };
}

/** Deletes an unused plan. A plan with subscriptions (even cancelled ones) is switched off instead. */
export async function deletePlan(tx: Tx, input: z.output<typeof planDeleteSchema>): Promise<{ audit: AuditEntry }> {
  const [row] = await tx.select().from(plans).where(eq(plans.id, input.id)).for("update").limit(1);
  if (!row) throw new PanelError("not_found", "Plan bulunamadı.");
  assertFresh(row.updatedAt, input.updatedAt);
  const [{ n }] = await tx.select({ n: count() }).from(subs).where(eq(subs.planId, input.id));
  if (n > 0) {
    throw new PanelError(
      "in_use",
      `Bu plan ${n} abonelikte kullanılıyor; silinemez. Yeni müşterilere sunulmasını durdurmak için planı pasifleştirin (mevcut abonelikler devam eder).`,
    );
  }
  // Cart lines on this plan become one-time purchases (FK set null) — the cart shows the note.
  await tx.delete(plans).where(eq(plans.id, input.id));
  return { audit: { action: "delete", entity: "subscription_plan", entityId: row.id, before: planValues({ ...row, name: row.name }) } };
}
