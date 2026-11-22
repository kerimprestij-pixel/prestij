// zod schemas of the B2B panel actions (Kurumsal Hesaplar, Müşteri Grupları, Müşteriler). Pure: the DB
// tests run them through executePanelAction exactly like the actions do. Messages are Turkish.
import { z } from "zod";
import { idInput, localizedTextOf, percentInputRange, slugInput, textInput, updatedAtInput } from "@/lib/panel/schemas";
import { BUSINESS_LIMITS, DEFERRED_DAYS } from "./application";

const optionalDays = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z
    .number({ error: `Vade süresini ${DEFERRED_DAYS.min}–${DEFERRED_DAYS.max} gün arasında girin.` })
    .int({ error: "Vade süresi tam gün olmalı." })
    .min(DEFERRED_DAYS.min, { error: `Vade en az ${DEFERRED_DAYS.min} gün olabilir.` })
    .max(DEFERRED_DAYS.max, { error: `Vade en fazla ${DEFERRED_DAYS.max} gün olabilir.` })
    .nullable(),
);

export const companyTermsSchema = z.object({
  id: idInput,
  groupId: z.coerce.number({ error: "Bir müşteri grubu seçin." }).int({ error: "Bir müşteri grubu seçin." }).positive({ error: "Bir müşteri grubu seçin." }),
  allowDeferred: z.boolean(),
  days: optionalDays,
  updatedAt: updatedAtInput,
});

export const rejectCompanySchema = z.object({
  id: idInput,
  reason: textInput({ max: BUSINESS_LIMITS.rejectionReason, requiredMessage: "Reddetme gerekçesini yazın; müşteriye e-postayla gönderilir." }),
  updatedAt: updatedAtInput,
});

/** The company editor posts raw field values; the action validates them with companyFieldsSchema. */
export const updateCompanySchema = z.object({
  id: idInput,
  fields: z.record(z.string(), z.unknown()),
  adminNote: textInput({ required: false, max: BUSINESS_LIMITS.adminNote }),
  updatedAt: updatedAtInput,
});

export const groupFieldsSchema = z.object({
  slug: slugInput,
  name: localizedTextOf({ max: 80, requiredMessage: "Grubun Türkçe adını yazın." }),
  isBusiness: z.boolean(),
  discountPercent: percentInputRange(0, 90),
  showPricesExVat: z.boolean(),
});

export const createGroupSchema = groupFieldsSchema;
export const updateGroupSchema = groupFieldsSchema.extend({ id: idInput, updatedAt: updatedAtInput });
export const deleteGroupSchema = z.object({ id: idInput, updatedAt: updatedAtInput });

const userIdInput = z.string({ error: "Müşteri bulunamadı." }).trim().min(1, { error: "Müşteri bulunamadı." }).max(64);

export const customerGroupSchema = z.object({
  userId: userIdInput,
  groupId: z.preprocess((v) => (v === "" || v === undefined ? null : v), idInput.nullable()),
  updatedAt: updatedAtInput,
});

export const customerBanSchema = z.object({ userId: userIdInput, banned: z.boolean(), updatedAt: updatedAtInput });
export const customerIdSchema = z.object({ userId: userIdInput });
