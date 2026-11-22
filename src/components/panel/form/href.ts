// Instant link feedback in the panel, using the server's own rule (isSafeHref) so client and server
// always agree; adds specific Turkish messages for the most common mistakes.
import { HREF_MESSAGE, isSafeHref } from "@/lib/panel/schemas";

export const HREF_HINT = HREF_MESSAGE;

/** Turkish error message for an invalid link, or null when it is valid (empty counts as valid). */
export function hrefError(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || isSafeHref(v)) return null;
  if (/\s/.test(v)) return "Bağlantıda boşluk olamaz.";
  if (v.startsWith("//")) return "Bağlantı // ile başlayamaz; tam adres için https:// yazın.";
  if (/^http:\/\//i.test(v)) return "Güvenli bağlantı kullanın: http:// yerine https://.";
  if (v.startsWith("#")) return "Bölüm bağlantısı # ve bir harfle başlamalı, ör. #sss.";
  return HREF_MESSAGE;
}

/** Light clean-up on blur: trims, and adds https:// to a bare domain ("prestij.com.tr/x"). */
export function tidyHref(value: string): string {
  const v = value.trim();
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) return `https://${v}`;
  return v;
}

export type { LinkTarget, LinkTargetGroup } from "@/lib/panel/pickers";
