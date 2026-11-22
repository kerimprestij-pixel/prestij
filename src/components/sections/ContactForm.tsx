// The contact form section: editorial intro on one side, the form card on the other. The form itself is
// a client component (ContactFormClient); `?konu=` is read there inside Suspense so the page stays static.
import { localize } from "@/i18n/localize";
import type { ContactSubject } from "@/lib/contact/subjects";
import ContactFormClient, { type ContactFormLabels } from "./ContactFormClient";
import { resolveLink } from "./links";
import type { ContactFormContent } from "./schemas";
import { GoldRule, Paragraphs, type SectionProps } from "./ui";

export default function ContactForm({ content, locale, messages }: SectionProps<ContactFormContent>) {
  const m = messages.contact;
  const fallbackLabel: Record<ContactSubject, string> = {
    general: m.subjectGeneral,
    quote: m.subjectQuote,
    sample: m.subjectSample,
    other: m.subjectOther,
  };
  const seen = new Set<ContactSubject>();
  const subjects = content.subjects.flatMap((s) => {
    if (seen.has(s.key)) return [];
    seen.add(s.key);
    return [{ key: s.key, label: localize(s.label, locale) || fallbackLabel[s.key] }];
  });
  const eyebrow = localize(content.eyebrow, locale);
  const title = localize(content.title, locale);

  const labels: ContactFormLabels = {
    name: m.name,
    email: m.email,
    phone: m.phone,
    subject: m.subject,
    message: m.message,
    submit: m.submit,
    submitting: m.submitting,
    success: m.success,
    successTitle: m.successTitle,
    sendAnother: m.sendAnother,
    namePlaceholder: m.namePlaceholder,
    emailPlaceholder: m.emailPlaceholder,
    phonePlaceholder: m.phonePlaceholder,
    phoneHint: m.phoneHint,
    placeholders: { general: m.placeholderGeneral, quote: m.placeholderQuote, sample: m.placeholderSample, other: m.placeholderOther },
    errorSummary: m.errorSummary,
    invalidName: m.invalidName,
    messageTooShort: m.messageTooShort,
    tooLong: m.tooLong,
    tooMany: m.tooMany,
    error: m.error,
    privacy: m.privacy,
    privacyLink: m.privacyLink,
    optional: messages.common.optional,
    required: messages.errors.required,
    invalidEmail: messages.errors.invalidEmail,
    invalidPhone: messages.errors.invalidPhone,
  };

  return (
    <section id="iletisim-formu" className="scroll-mt-28 py-16 md:py-24">
      <div className="container-x grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5 lg:pt-4">
          {eyebrow && <p className="eyebrow mb-5">{eyebrow}</p>}
          <h2 className="font-heading text-4xl leading-[1.05] tracking-tight text-balance text-text md:text-5xl">{title}</h2>
          <GoldRule className="my-8" />
          {content.intro && (
            <div className="max-w-md space-y-4 text-base leading-relaxed text-pretty text-text-muted md:text-lg">
              <Paragraphs text={content.intro} locale={locale} />
            </div>
          )}
        </div>
        <div className="min-w-0 lg:col-span-7">
          <div className="rounded-md border border-border bg-surface p-6 shadow-[0_24px_60px_-40px_rgb(3_38_95/0.35)] sm:p-10">
            <ContactFormClient
              locale={locale}
              subjects={subjects}
              labels={labels}
              privacyHref={resolveLink(locale, content.privacyHref || "/sayfa/kvkk")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
