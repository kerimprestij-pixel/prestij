import Link from "next/link";
import type { ReactNode } from "react";
import { isExternalHref } from "@/i18n/paths";

type SmartLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  /** Open in a new tab (defaults to true for http(s) links). */
  external?: boolean;
  /** Visually hidden suffix for links that open a new tab, e.g. "(opens in a new tab)". */
  newTabHint?: string;
  "aria-label"?: string;
};

/** next/link for internal paths, a plain anchor for mailto:, tel: and other sites. Hook-free. */
export default function SmartLink({ href, children, className, external, newTabHint, ...rest }: SmartLinkProps) {
  const opensNewTab = external ?? /^(https?:)?\/\//i.test(href);
  if (opensNewTab || isExternalHref(href)) {
    return (
      <a
        href={href}
        className={className}
        aria-label={rest["aria-label"]}
        {...(opensNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
        {opensNewTab && newTabHint ? <span className="sr-only"> {newTabHint}</span> : null}
      </a>
    );
  }
  return (
    <Link href={href} className={className} aria-label={rest["aria-label"]}>
      {children}
    </Link>
  );
}
