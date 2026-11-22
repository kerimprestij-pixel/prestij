// Contact form subjects. Pure: shared by the section schema, the storefront form, the server action
// and the panel inbox.

export const CONTACT_SUBJECTS = ["general", "quote", "sample", "other"] as const;
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number];

/**
 * `?konu=` value per subject. Links keep the Turkish value in every locale (localizePath leaves the
 * query alone): /iletisim?konu=teklif → /en/contact?konu=teklif.
 */
export const SUBJECT_PARAMS: Record<ContactSubject, string> = {
  general: "genel",
  quote: "teklif",
  sample: "numune",
  other: "diger",
};

/** Turkish names for the panel (the storefront labels come from the section content). */
export const CONTACT_SUBJECT_LABELS: Record<ContactSubject, string> = {
  general: "Genel soru",
  quote: "Teklif",
  sample: "Numune",
  other: "Diğer",
};

const ALIASES: Record<string, ContactSubject> = {
  genel: "general",
  teklif: "quote",
  numune: "sample",
  diger: "other",
  "diğer": "other",
  // English spellings, for hand-written links on the en/ar pages.
  samples: "sample",
  offer: "quote",
};

export function isContactSubject(value: unknown): value is ContactSubject {
  return typeof value === "string" && (CONTACT_SUBJECTS as readonly string[]).includes(value);
}

/** Subject for a `?konu=` value ("teklif", "numune", …, or the key itself); null when unknown. */
export function subjectFromParam(value: string | null | undefined): ContactSubject | null {
  const key = (value ?? "").trim().toLocaleLowerCase("tr");
  if (!key) return null;
  if (isContactSubject(key)) return key;
  return ALIASES[key] ?? null;
}
