// panelAction definitions of the Hediye Çarkı page besides the settings save (schema + run), kept apart
// from the "use server" file so DB tests can run them with executePanelAction.
import "server-only";
import { z } from "zod";
import { TAGS } from "@/lib/cache-tags";
import type { PanelActionOptions } from "@/lib/panel/action-core";
import { settingsVersionInput } from "@/lib/panel/settings/schemas";
import { WHEEL_LIMITS } from "@/lib/settings/types";
import { startNewWheelRound } from "./service";

type Def<S extends z.ZodType, T> = Pick<PanelActionOptions<S, T>, "schema" | "run">;

export const startWheelRoundInput = z.object({
  updatedAt: settingsVersionInput,
  round: z
    .number({ error: "Geçersiz tur numarası. Sayfayı yenileyin." })
    .int("Geçersiz tur numarası. Sayfayı yenileyin.")
    .min(WHEEL_LIMITS.round.min, "Geçersiz tur numarası. Sayfayı yenileyin.")
    .max(WHEEL_LIMITS.round.max, "Geçersiz tur numarası. Sayfayı yenileyin."),
});

export type StartWheelRoundResult = { round: number; updatedAt: string };

export const startWheelRoundDef: Def<typeof startWheelRoundInput, StartWheelRoundResult> = {
  schema: startWheelRoundInput,
  run: async (input, { tx }) => {
    const result = await startNewWheelRound(tx, input);
    return {
      data: { round: result.round, updatedAt: result.updatedAt.toISOString() },
      message: `${result.round}. tur başladı: ziyaretçiler çarkı yeniden çevirebilir.`,
      tags: [TAGS.settings, TAGS.wheel],
      audit: result.audit,
    };
  },
};
