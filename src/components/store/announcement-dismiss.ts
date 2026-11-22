// Shared between the server bar (pre-paint script) and the client rotator.

/** localStorage key holding the signature of the announcement set the visitor dismissed. */
export const ANNOUNCEMENT_DISMISS_KEY = "prestij:announcement-dismissed";
/** Attribute on <html> that hides the bar (set before first paint, so a dismissed bar never flashes). */
export const ANNOUNCEMENT_HIDDEN_ATTR = "data-announcement-hidden";

/** Inline script placed right after the bar: hides it before paint if this exact set was dismissed. */
export function announcementPrePaintScript(signature: string): string {
  return `try{if(localStorage.getItem(${JSON.stringify(ANNOUNCEMENT_DISMISS_KEY)})===${JSON.stringify(
    signature,
  )})document.documentElement.setAttribute(${JSON.stringify(ANNOUNCEMENT_HIDDEN_ATTR)},"")}catch(e){}`;
}
