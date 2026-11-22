import { getActiveThemeCss } from "./get-active-theme";

/**
 * Injects the active theme's CSS variables (:root + .dark). Render inside <head> of the storefront
 * root layout. The data is "use cache" (tags theme + campaigns; a lifetime that ends before the next
 * scheduled theme change), so it is part of the static shell and needs no <Suspense>.
 */
export default async function ThemeStyle() {
  const { slug, css } = await getActiveThemeCss();
  return <style id="prestij-theme" data-theme={slug} dangerouslySetInnerHTML={{ __html: css }} />;
}
