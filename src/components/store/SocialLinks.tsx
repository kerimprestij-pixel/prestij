import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/utils";
import { FacebookIcon, InstagramIcon, LinkedinIcon, TiktokIcon, YoutubeIcon } from "./BrandIcons";

type Social = { instagram?: string; facebook?: string; youtube?: string; tiktok?: string; linkedin?: string };

const PLATFORMS: { key: keyof Social; name: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { key: "instagram", name: "Instagram", Icon: InstagramIcon },
  { key: "facebook", name: "Facebook", Icon: FacebookIcon },
  { key: "youtube", name: "YouTube", Icon: YoutubeIcon },
  { key: "tiktok", name: "TikTok", Icon: TiktokIcon },
  { key: "linkedin", name: "LinkedIn", Icon: LinkedinIcon },
];

/** Accepts a full URL or a bare handle ("prestij" → https://instagram.com/prestij). */
function profileUrl(key: keyof Social, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const handle = trimmed.replace(/^@/, "");
  const base: Record<keyof Social, string> = {
    instagram: "https://instagram.com/",
    facebook: "https://facebook.com/",
    youtube: "https://youtube.com/@",
    tiktok: "https://tiktok.com/@",
    linkedin: "https://linkedin.com/company/",
  };
  return /^[\w.-]+$/.test(handle) ? base[key] + handle : null;
}

type SocialLinksProps = { social: Social; label: string; newTabHint: string; className?: string; linkClassName?: string };

/** Row of social profile icons from settings.general.social (renders nothing when none are set). */
export default function SocialLinks({ social, label, newTabHint, className, linkClassName }: SocialLinksProps) {
  const links = PLATFORMS.flatMap(({ key, name, Icon }) => {
    const url = social[key] ? profileUrl(key, social[key] as string) : null;
    return url ? [{ key, name, Icon, url }] : [];
  });
  if (links.length === 0) return null;

  return (
    <ul aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)}>
      {links.map(({ key, name, Icon, url }) => (
        <li key={key}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${name} ${newTabHint}`}
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
              linkClassName,
            )}
          >
            <Icon className="size-[1.125rem]" />
          </a>
        </li>
      ))}
    </ul>
  );
}
