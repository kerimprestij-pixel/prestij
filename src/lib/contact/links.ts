// Links for the contact channels kept in settings (pure). Used by the contact_info section and the
// panel inbox (reply by phone / WhatsApp).

/** "0352 353 30 70" → "tel:+903523533070" (a Turkish trunk 0 becomes +90). Null without digits. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7) return null;
  if (digits.startsWith("+")) return `tel:${digits}`;
  if (digits.startsWith("00")) return `tel:+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `tel:+90${digits.slice(1)}`;
  return `tel:${digits}`;
}

/** International digits without "+" ("903523533070"); a Turkish trunk 0 becomes 90. */
export function internationalDigits(phone: string | null | undefined): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = `90${digits.slice(1)}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** wa.me chat link with an optional prefilled message. */
export function whatsappHref(phone: string | null | undefined, text?: string | null): string | null {
  const digits = internationalDigits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** "903523533070" → "+90 352 353 30 70" (Turkish numbers grouped; others "+<digits>"). */
export function formatInternationalPhone(phone: string | null | undefined): string {
  const digits = internationalDigits(phone);
  if (!digits) return (phone ?? "").trim();
  const tr = /^90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  return tr ? `+90 ${tr[1]} ${tr[2]} ${tr[3]} ${tr[4]}` : `+${digits}`;
}

/**
 * Map link for the address: the panel's own map URL when it is a plain https:// link, otherwise a
 * Google Maps search for the address text.
 */
export function mapHref(mapUrl: string | null | undefined, addressText: string): string | null {
  const own = (mapUrl ?? "").trim();
  if (/^https:\/\/[^\s/@\\]+\.[^\s/@\\]+(?:[/?#][^\s]*)?$/i.test(own)) return own;
  const query = addressText.trim();
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}
