// Shared class strings and a text helper for the account and auth pages. No directive: usable from
// server and client components alike.
import type { ReactNode } from "react";

/** The card around an auth or account form. */
export const formCardClass = "rounded-md border border-border bg-surface p-6 shadow-[0_24px_60px_-40px_rgb(3_38_95/0.35)] sm:p-10";

/** A plain bordered panel inside the account area. */
export const panelClass = "rounded-md border border-border bg-surface p-5 sm:p-7";

/** Underlined text link with the gold accent. */
export const textLinkClass = "font-medium text-text underline decoration-gold underline-offset-4 transition-[text-decoration-color] hover:decoration-2";

/** Section title inside an account page. */
export const sectionTitleClass = "font-heading text-2xl leading-tight text-text md:text-[1.75rem]";

/** Fills a template's {link} placeholder with a React node. */
export function withLink(template: string, link: ReactNode, placeholder = "{link}"): ReactNode {
  const index = template.indexOf(placeholder);
  if (index === -1) return template;
  return (
    <>
      {template.slice(0, index)}
      {link}
      {template.slice(index + placeholder.length)}
    </>
  );
}
