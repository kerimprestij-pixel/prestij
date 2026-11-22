// Brand glyphs that lucide-react 1.x no longer ships. Stroke icons on a 24px grid, currentColor.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Stroke({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </Stroke>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </Stroke>
  );
}

export function YoutubeIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M2.5 17a24 24 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.6 49.6 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24 24 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.6 49.6 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </Stroke>
  );
}

export function LinkedinIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </Stroke>
  );
}

export function TiktokIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 3c.4 2.6 2.4 4.6 5 5" />
    </Stroke>
  );
}

export function WhatsAppIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
      <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
    </Stroke>
  );
}

/** The small gold crown from the PRESTİJ logo (used by the text wordmark). */
export function CrownMark(props: IconProps) {
  return (
    <svg viewBox="0 0 28 14" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M2 12.5 1 3.2l6.3 4.2L14 .8l6.7 6.6L27 3.2l-1 9.3z" />
      <circle cx="1" cy="2.6" r="1" />
      <circle cx="14" cy="0.9" r="0.9" />
      <circle cx="27" cy="2.6" r="1" />
    </svg>
  );
}
