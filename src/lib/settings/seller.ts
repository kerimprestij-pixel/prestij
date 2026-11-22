// Seller identity shown to visitors (go-live CF-9, e-commerce regulation RG 32058 m.5: the service provider's
// name, MERSİS number, address, phone, e-mail, KEP address, professional chamber with access to its rules,
// and a registered trademark if any). Pure: the footer and the contact section render these rows from the
// cached general settings; the panel's launch checklist lists what is still missing. Unit-tested in
// tests/unit/golive-seller.test.ts.
import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { isSafeHref } from "@/lib/safe-href";
import type { Settings } from "./types";

export type SellerIdentityLabels = {
  legalName: string;
  mersisNo: string;
  kep: string;
  chamber: string;
  chamberRules: string;
  trademark: string;
};

export type SellerIdentityKey = "legalName" | "mersisNo" | "kep" | "chamber" | "trademark";

export type SellerIdentityRow = {
  key: SellerIdentityKey;
  label: string;
  /** The value as entered (Latin script for most fields: render it inside <bdi>). */
  value: string;
  /** chamber: the https:// page of the chamber's professional rules, when set and safe. */
  href: string | null;
};

type SellerFields = Pick<Settings<"general">, "legalName" | "mersisNo" | "kep" | "chamber" | "trademark">;

/** A plain https:// link that passes the storefront link rule (re-checked on render, like every settings link). */
export function chamberRulesHref(raw: string | null | undefined): string | null {
  const url = (raw ?? "").trim();
  return /^https:\/\/[^\s/@\\]+\.[^\s/@\\]+(?:[/?#][^\s]*)?$/i.test(url) && isSafeHref(url) ? url : null;
}

/**
 * The filled identity fields, in display order: legal name, MERSİS no, KEP address, chamber (name, with the
 * rules link when set), registered trademark. Empty fields are left out; the chamber needs its name.
 * `legalName: false` leaves the legal name out (a caller that prints it elsewhere).
 */
export function sellerIdentityRows(
  general: SellerFields,
  locale: Locale,
  labels: SellerIdentityLabels,
  options: { legalName?: boolean } = {},
): SellerIdentityRow[] {
  const rows: SellerIdentityRow[] = [];
  const add = (key: SellerIdentityKey, label: string, value: string | null | undefined, href: string | null = null) => {
    const text = (value ?? "").trim();
    if (text) rows.push({ key, label, value: text, href });
  };
  if (options.legalName !== false) add("legalName", labels.legalName, general.legalName);
  add("mersisNo", labels.mersisNo, general.mersisNo);
  add("kep", labels.kep, general.kep);
  add("chamber", labels.chamber, localize(general.chamber?.name, locale), chamberRulesHref(general.chamber?.rulesUrl));
  add("trademark", labels.trademark, general.trademark);
  return rows;
}

type ChecklistFields = Pick<
  Settings<"general">,
  "legalName" | "mersisNo" | "taxOffice" | "taxNumber" | "kep" | "email" | "phone" | "address" | "chamber"
>;

/** The seller fields the go-live rule requires, in the order they are listed. */
export const REQUIRED_SELLER_FIELDS = [
  "legalName",
  "mersisNo",
  "taxOffice",
  "taxNumber",
  "kep",
  "email",
  "phone",
  "address",
  "chamber",
  "chamberRules",
] as const;
export type RequiredSellerField = (typeof REQUIRED_SELLER_FIELDS)[number];

/** Turkish (panel, owner) and English (script logs) names of the required seller fields. */
export const SELLER_FIELD_NAMES: Record<RequiredSellerField, { tr: string; en: string }> = {
  legalName: { tr: "ticari unvan", en: "legal name" },
  mersisNo: { tr: "MERSİS numarası", en: "MERSİS number" },
  taxOffice: { tr: "vergi dairesi", en: "tax office" },
  taxNumber: { tr: "vergi numarası", en: "tax number" },
  kep: { tr: "KEP adresi", en: "KEP address" },
  email: { tr: "e-posta", en: "e-mail" },
  phone: { tr: "telefon", en: "phone" },
  address: { tr: "adres", en: "address (street, district, city)" },
  chamber: { tr: "meslek odası", en: "professional chamber" },
  chamberRules: { tr: "meslek kuralları bağlantısı", en: "link to the chamber's professional rules (https://)" },
};

/**
 * The required seller fields still missing in Ayarlar › Firma bilgileri. ONE rule (FIX F3) for the panel's
 * "Satıcı bilgileri eksiksiz" go-live step and the go-live sales profile (scripts/golive/rules.ts sellerProblems):
 * legal name, MERSİS, tax office and number, KEP, e-mail, phone, the address with street, district and city, the
 * chamber's name and a usable https:// link to its rules (the footer links only what chamberRulesHref accepts).
 * The registered trademark is optional (only if one exists) and never listed.
 */
export function missingSellerFieldKeys(general: ChecklistFields): RequiredSellerField[] {
  const blank = (value: string | null | undefined) => !(value ?? "").trim();
  const address = general.address;
  const missing: Record<RequiredSellerField, boolean> = {
    legalName: blank(general.legalName),
    mersisNo: blank(general.mersisNo),
    taxOffice: blank(general.taxOffice),
    taxNumber: blank(general.taxNumber),
    kep: blank(general.kep),
    email: blank(general.email),
    phone: blank(general.phone),
    address: !address || blank(address.line) || blank(address.district) || blank(address.city),
    chamber: blank(general.chamber?.name?.tr),
    chamberRules: chamberRulesHref(general.chamber?.rulesUrl) === null,
  };
  return REQUIRED_SELLER_FIELDS.filter((field) => missing[field]);
}

/** Turkish names of the missing seller fields (missingSellerFieldKeys), for the panel's go-live step. */
export function missingSellerFields(general: ChecklistFields): string[] {
  return missingSellerFieldKeys(general).map((field) => SELLER_FIELD_NAMES[field].tr);
}
