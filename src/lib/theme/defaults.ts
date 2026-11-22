import type { ThemeTokens } from "@/db/schema";

/** Slug and name of the built-in fallback theme (also the seeded default theme). */
export const DEFAULT_THEME_SLUG = "prestij-klasik";
export const DEFAULT_THEME_NAME = "PRESTİJ Klasik";

/** "PRESTİJ Klasik": logo navy + logo gold on warm ivory. Used when the database has no usable theme. */
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  colors: {
    brand: "#03265F",
    accent: "#DDA82A",
    background: "#F9F8F5",
    surface: "#FFFFFF",
    text: "#14284B",
  },
  radius: "md",
};
