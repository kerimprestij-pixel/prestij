// Result shape of every panel Server Action. Pure (types + tiny helpers): safe in client components.
import type { PanelErrorCode } from "./errors";

export type { PanelErrorCode };

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | {
      ok: false;
      error: string;
      code: PanelErrorCode;
      fieldErrors?: Record<string, string>;
      /** No session any more (expired, signed out elsewhere): nothing was saved; sign in and save again. */
      sessionExpired?: true;
    };

/** Message of the `sessionExpired` result (code "forbidden"). */
export const SESSION_EXPIRED_MESSAGE = "Oturumunuz sona erdi; değişiklikler kaydedilmedi. Yeni sekmede tekrar giriş yapın, sonra bu sayfada yeniden kaydedin.";

/** Panel login URL that returns to `path` after signing in. */
export function panelLoginHref(path: string): string {
  return `/panel/giris?next=${encodeURIComponent(path)}`;
}

/** Name of the single form field panel forms post: JSON.stringify(state). */
export const PAYLOAD_FIELD = "payload";

/** FormData for a panel action: `action(null, toPayloadFormData(state))` or `<form action>` + hidden input. */
export function toPayloadFormData(value: unknown): FormData {
  const form = new FormData();
  form.set(PAYLOAD_FIELD, JSON.stringify(value ?? null));
  return form;
}
