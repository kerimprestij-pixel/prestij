import { THEME_STORAGE_KEY } from "./mode";

// Runs during HTML parsing, before first paint: applies the saved light/dark/system preference to <html>
// and keeps following the OS setting while the preference is "system" (also across tabs).
// Mirrors mode.ts (kept tiny and dependency-free on purpose).
const SCRIPT = `(function(){try{var d=document.documentElement,k=${JSON.stringify(THEME_STORAGE_KEY)},m=window.matchMedia("(prefers-color-scheme: dark)");function p(){var v=null;try{v=localStorage.getItem(k)}catch(e){}return v==="light"||v==="dark"?v:"system"}function a(){var v=p();d.classList.toggle("dark",v==="dark"||(v==="system"&&m.matches))}a();var s=function(){if(p()==="system")a()};if(m.addEventListener)m.addEventListener("change",s);else m.addListener(s);window.addEventListener("storage",function(e){if(e.key===k||e.key===null)a()})}catch(e){}})();`;

/**
 * Put first in <head> of the storefront root layout. <html> needs `suppressHydrationWarning`,
 * because this script changes its class before React hydrates.
 */
export default function ThemeScript() {
  return <script id="prestij-theme-script" dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
