// Turkish labels and link helpers for the panel inbox (pure; server and client).
import type { Tone } from "@/components/panel/labels";
import { CONTACT_SUBJECT_LABELS, CONTACT_SUBJECTS, SUBJECT_PARAMS, type ContactSubject } from "@/lib/contact/subjects";

export const SUBJECT_TONE: Record<ContactSubject, Tone> = {
  general: "neutral",
  quote: "gold",
  sample: "info",
  other: "neutral",
};

export const subjectLabel = (subject: ContactSubject | null): string => (subject ? CONTACT_SUBJECT_LABELS[subject] : "Konu belirtilmemiş");

/** Storefront language the message came from. */
export const LOCALE_LABEL: Record<string, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };

export const SUBJECT_FILTERS: { key: ContactSubject; label: string }[] = CONTACT_SUBJECTS.map((key) => ({
  key,
  label: CONTACT_SUBJECT_LABELS[key],
}));

/** /panel/mesajlar with the given filters (Turkish query values: durum=okunmamis, konu=teklif, ara, sayfa). */
export function messagesListHref(input: { unread?: boolean; subject?: ContactSubject | null; q?: string; page?: number } = {}): string {
  const params = new URLSearchParams();
  if (input.unread) params.set("durum", "okunmamis");
  if (input.subject) params.set("konu", SUBJECT_PARAMS[input.subject]);
  if (input.q) params.set("ara", input.q);
  if (input.page && input.page > 1) params.set("sayfa", String(input.page));
  const query = params.toString();
  return query ? `/panel/mesajlar?${query}` : "/panel/mesajlar";
}

const REPLY: Record<string, { subject: string; greeting: (name: string) => string; quote: string }> = {
  tr: { subject: "PRESTİJ | Mesajınız hakkında", greeting: (n) => `Merhaba ${n},`, quote: "Mesajınız:" },
  en: { subject: "PRESTİJ | About your message", greeting: (n) => `Hello ${n},`, quote: "Your message:" },
  ar: { subject: "PRESTİJ | بخصوص رسالتك", greeting: (n) => `مرحبًا ${n}،`, quote: "رسالتك:" },
};

/** mailto: link that opens a reply in the sender's language, quoting the start of the message. */
export function replyMailto(input: { email: string; name: string; message: string; locale: string }): string {
  const t = REPLY[input.locale] ?? REPLY.tr;
  const quoted = input.message.length > 600 ? `${input.message.slice(0, 600)}…` : input.message;
  const body = `${t.greeting(input.name.split(" ")[0] || input.name)}\n\n\n\n---\n${t.quote}\n${quoted}`;
  return `mailto:${encodeURIComponent(input.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(body)}`;
}
