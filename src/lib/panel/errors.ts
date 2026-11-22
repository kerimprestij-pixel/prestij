// Errors that panel services throw on purpose. panelAction turns them into an ActionResult; anything
// else is logged (safeErrorInfo) and answered with a generic Turkish message. Pure: safe on the client.

export type PanelErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "in_use" | "server";

export const PANEL_ERROR_CODES: readonly PanelErrorCode[] = ["invalid", "forbidden", "not_found", "conflict", "in_use", "server"];

/** Default Turkish messages per code (used when a service throws without its own message). */
export const PANEL_ERROR_MESSAGES: Record<PanelErrorCode, string> = {
  invalid: "Lütfen işaretli alanları düzeltin.",
  forbidden: "Bu işlem için yetkiniz yok.",
  not_found: "Kayıt bulunamadı. Silinmiş olabilir; sayfayı yenileyin.",
  conflict: "Bu kayıt siz düzenlerken başka biri tarafından değiştirildi. Sayfayı yenileyin.",
  in_use: "Bu kayıt başka yerlerde kullanıldığı için bu işlem yapılamaz.",
  server: "İşlem kaydedilemedi. Lütfen tekrar deneyin.",
};

export class PanelError extends Error {
  readonly code: PanelErrorCode;
  /** Dotted field paths (e.g. "variants.2.price") → Turkish message. */
  readonly fieldErrors?: Record<string, string>;

  constructor(code: PanelErrorCode, message?: string, fieldErrors?: Record<string, string>) {
    super(message ?? PANEL_ERROR_MESSAGES[code]);
    this.name = "PanelError";
    this.code = code;
    if (fieldErrors && Object.keys(fieldErrors).length > 0) this.fieldErrors = fieldErrors;
  }
}

export function isPanelError(error: unknown): error is PanelError {
  return error instanceof PanelError;
}

/** Shorthand for one invalid field: `throw fieldError("slug", "Bu kısa ad kullanılıyor.")`. */
export function fieldError(path: string, message: string): PanelError {
  return new PanelError("invalid", message, { [path]: message });
}
