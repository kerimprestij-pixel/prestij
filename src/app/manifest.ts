// /manifest.webmanifest (Web App Manifest). A metadata file in the root of `app`, next to the
// [locale] root layout: Next serves it as a cached route handler and links it from every storefront
// page's <head> (like icon.png / apple-icon.png beside it). Reads cached settings only, so it is
// prerendered and follows a settings save. src/proxy.ts never localizes it (its matcher skips "manifest").
import type { MetadataRoute } from "next";
import { defaultLocale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import { getSettings } from "@/lib/settings/get-settings";

/** Brand ivory (docs/ARCHITECTURE.md "Design direction"); the same light theme-color the root layout sets. */
const BRAND_IVORY = "#F9F8F5";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [general, seo] = await Promise.all([getSettings("general"), getSettings("seo")]);
  const name = general.siteName.trim() || "PRESTİJ";
  const description = localize(seo.description, defaultLocale);
  const start = href(defaultLocale, "home");
  return {
    id: start,
    name,
    short_name: name,
    ...(description ? { description } : {}),
    lang: defaultLocale,
    dir: "ltr",
    start_url: start,
    scope: "/",
    display: "standalone",
    background_color: BRAND_IVORY,
    theme_color: BRAND_IVORY,
    categories: ["shopping"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
