"use client";
// Runs a panelAction outside a form (list rows, delete buttons): sends `payload`, toasts the result.
import { useCallback, useTransition } from "react";
import type { PanelFormAction } from "@/components/panel/form";
import { toast } from "@/components/panel/ui";
import { toPayloadFormData, type ActionResult } from "@/lib/panel/action-types";

const NETWORK_ERROR = "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.";

export function useActionRunner() {
  const [pending, startTransition] = useTransition();
  const run = useCallback(
    <T>(action: PanelFormAction<T>, payload: unknown, options: { onSuccess?: (data: T | undefined) => void; quiet?: boolean } = {}) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          let result: ActionResult<T>;
          try {
            result = await action(null, toPayloadFormData(payload));
          } catch {
            result = { ok: false, code: "server", error: NETWORK_ERROR };
          }
          if (result.ok) {
            if (!options.quiet) toast.success(result.message ?? "İşlem tamamlandı.");
            options.onSuccess?.(result.data);
          } else if (result.code === "conflict") {
            toast.error(result.error, { duration: 0, action: { label: "Sayfayı yenile", onClick: () => window.location.reload() } });
          } else {
            toast.error(result.error);
          }
          resolve(result);
        });
      }),
    [],
  );
  return { pending, run };
}
