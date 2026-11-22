"use server";
// Subscriptions in the panel: pause / resume / cancel on behalf of a customer (editor) and the plans
// (admin). Plans are read by static product pages (tag subscription-plans); subscriptions are never
// cached (panelAction then refreshes the current page).
import { TAGS } from "@/lib/cache-tags";
import { panelAction } from "@/lib/panel/action";
import {
  createPlan,
  deletePlan,
  planCreateSchema,
  planDeleteSchema,
  planUpdateSchema,
  staffChangeSchema,
  staffChangeSubscription,
  updatePlan,
} from "@/lib/subscriptions/panel-service";

export const changeSubscriptionAction = panelAction({
  minRole: "editor",
  schema: staffChangeSchema,
  run: async (input, { tx, actor }) => {
    const { message, updatedAt, audit } = await staffChangeSubscription(tx, input, { userId: actor.user.id, role: actor.staffRole });
    return { data: { updatedAt: updatedAt.toISOString() }, message, audit };
  },
});

export const createPlanAction = panelAction({
  minRole: "admin",
  schema: planCreateSchema,
  run: async (input, { tx }) => {
    const { id, updatedAt, audit } = await createPlan(tx, input);
    return { data: { id, updatedAt: updatedAt.toISOString() }, message: "Plan oluşturuldu.", tags: [TAGS.subscriptionPlans], audit };
  },
});

export const savePlanAction = panelAction({
  minRole: "admin",
  schema: planUpdateSchema,
  run: async (input, { tx }) => {
    const { id, updatedAt, audit } = await updatePlan(tx, input);
    return { data: { id, updatedAt: updatedAt.toISOString() }, message: "Plan kaydedildi.", tags: [TAGS.subscriptionPlans], audit };
  },
});

export const deletePlanAction = panelAction({
  minRole: "admin",
  schema: planDeleteSchema,
  run: async (input, { tx }) => {
    const { audit } = await deletePlan(tx, input);
    return { message: "Plan silindi.", tags: [TAGS.subscriptionPlans], audit };
  },
});
