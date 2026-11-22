"use server";
// Coupon Server Actions (editor+). Coupons are never cached, so no tags (panelAction then refreshes
// the current panel page). Business rules live in src/lib/panel/marketing/coupons.ts.
import { panelAction } from "@/lib/panel/action";
import { createCoupon, deleteCoupon, setCouponActive, updateCoupon } from "@/lib/panel/marketing/coupons";
import { couponCreateSchema, couponUpdateSchema, recordRefSchema, toggleActiveSchema } from "@/lib/panel/marketing/schemas";

export const createCouponAction = panelAction({
  minRole: "editor",
  schema: couponCreateSchema,
  run: async (input, { tx }) => {
    const { id, code, updatedAt, audit } = await createCoupon(tx, input);
    return { data: { id, updatedAt: updatedAt.toISOString() }, message: `“${code}” kuponu oluşturuldu.`, audit };
  },
});

export const saveCouponAction = panelAction({
  minRole: "editor",
  schema: couponUpdateSchema,
  run: async (input, { tx }) => {
    const { id, updatedAt, audit } = await updateCoupon(tx, input);
    return { data: { id, updatedAt: updatedAt.toISOString() }, message: "Kupon kaydedildi.", audit };
  },
});

export const setCouponActiveAction = panelAction({
  minRole: "editor",
  schema: toggleActiveSchema,
  run: async (input, { tx }) => {
    const { id, code, updatedAt, audit } = await setCouponActive(tx, input);
    return {
      data: { id, updatedAt: updatedAt.toISOString() },
      message: input.isActive ? `“${code}” yeniden etkin.` : `“${code}” pasifleştirildi; artık kullanılamaz.`,
      audit,
    };
  },
});

export const deleteCouponAction = panelAction({
  minRole: "editor",
  schema: recordRefSchema,
  run: async (input, { tx }) => {
    const { audit } = await deleteCoupon(tx, input);
    return { message: "Kupon silindi.", audit };
  },
});
