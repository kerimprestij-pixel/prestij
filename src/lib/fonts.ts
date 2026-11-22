import { Cormorant_Garamond, IBM_Plex_Sans_Arabic, Manrope, Noto_Naskh_Arabic } from "next/font/google";

// Preloaded (every storefront page, above the fold): Cormorant roman and Manrope, latin + latin-ext.
// Turkish needs both subsets: ı, ç, ö, ü are in latin, but ğ, ş, İ (e.g. "Duş Jeli" in the home <h1>)
// live in latin-ext. Not preloaded, fetched only where used: Cormorant italic (blog lead paragraph,
// taglines, blockquotes, mostly below the fold) and the Arabic faces (globals.css switches to them
// under html[lang="ar"], so /tr and /en don't pay for them).

const cormorant = Cormorant_Garamond({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  style: "normal",
  variable: "--font-cormorant",
  display: "swap",
});

// Its own instance so its files are not preloaded. Italic heading text reaches it through
// --font-heading-italic (theme engine), which globals.css swaps in on italic elements.
const cormorantItalic = Cormorant_Garamond({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  style: "italic",
  variable: "--font-cormorant-italic",
  preload: false,
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  variable: "--font-manrope",
  display: "swap",
});

const naskh = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  variable: "--font-naskh",
  preload: false,
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-arabic",
  preload: false,
  display: "swap",
});

/**
 * Put on <html>: defines --font-cormorant, --font-cormorant-italic, --font-manrope, --font-naskh and
 * --font-plex-arabic.
 */
export const fontVariables = [cormorant.variable, cormorantItalic.variable, manrope.variable, naskh.variable, plexArabic.variable].join(" ");
