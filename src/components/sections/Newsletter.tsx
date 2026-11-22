// Newsletter sign-up band. The form itself is the shell's NewsletterForm (İYS/KVKK consent).
// Renders nothing while the newsletter is switched off (Ayarlar → E-bülten; go-live SR-1), like the
// footer band. The switch is a cached settings read (tag `settings`, refreshed when the panel saves), so
// the page stays static.
import NewsletterForm from "@/components/store/NewsletterForm";
import { getMediaByIds } from "@/lib/data/media";
import { localize } from "@/i18n/localize";
import Img from "@/lib/media/Img";
import { getSettings } from "@/lib/settings/get-settings";
import { cn } from "@/lib/utils";
import type { NewsletterContent } from "./schemas";
import { GoldRule, type SectionProps } from "./ui";

export default async function Newsletter({ content, locale, messages }: SectionProps<NewsletterContent>) {
  const newsletter = await getSettings("newsletter");
  if (!newsletter.enabled) return null;
  const media = content.imageId ? await getMediaByIds([content.imageId]) : {};
  const image = content.imageId ? media[content.imageId] : undefined;
  const eyebrow = localize(content.eyebrow, locale) || messages.footer.newsletter;
  const title = localize(content.title, locale) || messages.newsletter.title;
  const body = localize(content.body, locale) || messages.newsletter.subtitle;

  return (
    <section data-newsletter-section className="bg-surface-2 py-20 md:py-28">
      <div className={cn("container-x grid grid-cols-1 items-center gap-12", image && "lg:grid-cols-2 lg:gap-20")}>
        {image && (
          <div className="relative hidden aspect-[5/4] overflow-hidden rounded-md lg:block">
            <Img media={image} alt={localize(image.alt, locale)} locale={locale} sizes="45vw" fill />
          </div>
        )}
        <div className={cn("w-full min-w-0 max-w-xl", !image && "mx-auto text-center")}>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-5 font-heading text-4xl leading-[1.05] tracking-tight text-balance text-text md:text-5xl">{title}</h2>
          <GoldRule className={cn("my-7", !image && "mx-auto")} />
          {body && <p className="text-base leading-relaxed whitespace-pre-line text-text-muted md:text-lg">{body}</p>}
          <NewsletterForm locale={locale} labels={messages.newsletter} source="section" className={cn("mt-8", !image && "text-start")} />
        </div>
      </div>
    </section>
  );
}
