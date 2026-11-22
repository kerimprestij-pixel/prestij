// Search engine ownership meta tags from settings.seo.verification (the root locale layout puts them on
// every storefront page, home included). Pure.
//   google → <meta name="google-site-verification" content="…">  (Metadata verification.google)
//   yandex → <meta name="yandex-verification" content="…">       (Metadata verification.yandex)
//   bing   → <meta name="msvalidate.01" content="…">             (Metadata verification.other)
import type { Metadata } from "next";
import { SEO_VERIFICATION_MAX_LENGTH, SEO_VERIFICATION_PATTERN, type Settings } from "@/lib/settings/types";

const usable = (code: string | null | undefined): string => {
  const value = (code ?? "").trim();
  return value && value.length <= SEO_VERIFICATION_MAX_LENGTH && SEO_VERIFICATION_PATTERN.test(value) ? value : "";
};

/** The `verification` metadata for the filled codes, or undefined when none is set (no tags at all). */
export function verificationMetadata(codes: Settings<"seo">["verification"]): Metadata["verification"] | undefined {
  const google = usable(codes.google);
  const yandex = usable(codes.yandex);
  const bing = usable(codes.bing);
  if (!google && !yandex && !bing) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(yandex ? { yandex } : {}),
    ...(bing ? { other: { "msvalidate.01": bing } } : {}),
  };
}
