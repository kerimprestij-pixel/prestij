import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import EmailTemplateEditor, { type TemplateEditorState } from "@/components/panel/emails/EmailTemplateEditor";
import { SettingsFormSkeleton } from "@/components/panel/settings/SettingsPageFrame";
import { LOCALES, type Locale } from "@/i18n/locales";
import { emailTemplateDefaults, getEmailTemplate, GLOBAL_PLACEHOLDERS } from "@/lib/email";
import { REQUIRED_EMAIL_TEMPLATES } from "@/lib/panel/emails/templates";
import { readSettingsRow } from "@/lib/panel/settings/service";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "E-posta şablonu · Ayarlar" };

type Params = Promise<{ key: string }>;

export default function EmailTemplatePage({ params }: { params: Params }) {
  return (
    <div className="space-y-6">
      <Link
        href="/panel/ayarlar/e-posta"
        className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden className="size-4" />
        E-posta ayarları
      </Link>
      <Suspense fallback={<SettingsFormSkeleton cards={2} />}>
        <Editor params={params} />
      </Suspense>
    </div>
  );
}

async function Editor({ params }: { params: Params }) {
  const session = await requireStaff("admin");
  const { key } = await params;
  const template = getEmailTemplate(key);
  if (!template) notFound();
  const row = await readSettingsRow("emails");
  const saved = row.value.templates[template.key];
  const locales: Locale[] = template.audience === "admin" ? ["tr"] : [...LOCALES];
  const defaults = Object.fromEntries(
    await Promise.all(locales.map(async (l) => [l, (await emailTemplateDefaults(template.key, l)) ?? { subject: "", intro: "" }] as const)),
  ) as Record<Locale, { subject: string; intro: string }>;

  const initial: TemplateEditorState = {
    key: template.key,
    enabled: saved?.enabled ?? true,
    subject: saved?.subject ?? null,
    intro: saved?.intro ?? null,
    updatedAt: row.updatedAt,
  };

  return (
    <EmailTemplateEditor
      initial={initial}
      info={{
        key: template.key,
        label: template.label,
        description: template.description ?? null,
        audience: template.audience,
        marketing: Boolean(template.marketing),
        required: REQUIRED_EMAIL_TEMPLATES.includes(template.key),
        placeholders: [...template.placeholders, ...GLOBAL_PLACEHOLDERS],
      }}
      locales={locales}
      defaults={defaults}
      testRecipient={session.user.email}
    />
  );
}
