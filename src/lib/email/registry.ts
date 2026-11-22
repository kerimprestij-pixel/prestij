// The template registry (pure). Template files call defineEmailTemplate at module load; importing
// "@/lib/email/templates" (done by the e-mail system's entry points) registers all of them.
import { EMAIL_TEMPLATE_KEY } from "@/lib/settings/types";
import type { EmailTemplate, EmailTemplateDefinition, TemplateKey } from "./types";

/** The same pattern settings.emails.templates accepts, so every registered key can be overridden in the panel. */
const KEY_PATTERN = EMAIL_TEMPLATE_KEY;
const PLACEHOLDER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

type AnyTemplate = EmailTemplate<TemplateKey>;

const globalRegistry = globalThis as typeof globalThis & { __prestijEmailTemplates?: Map<string, AnyTemplate> };
// On globalThis so a dev hot reload of one template file replaces its entry instead of losing others.
const registry: Map<string, AnyTemplate> = (globalRegistry.__prestijEmailTemplates ??= new Map());

/**
 * Registers a template. The key must also be declared in EmailTemplateRegistry (module augmentation
 * in the template file) so enqueueEmail type-checks its data. Re-registering a key replaces it (hot
 * reload); two different files using one key is a bug, so keep keys unique per area.
 */
export function defineEmailTemplate<K extends TemplateKey>(definition: EmailTemplateDefinition<K>): EmailTemplate<K> {
  if (!KEY_PATTERN.test(definition.key)) throw new Error(`E-mail template key "${definition.key}" must be snake_case.`);
  for (const name of definition.placeholders) {
    if (!PLACEHOLDER_PATTERN.test(name)) throw new Error(`E-mail template "${definition.key}": invalid placeholder "${name}".`);
  }
  const template = { ...definition, label: definition.label ?? definition.key } as EmailTemplate<K>;
  registry.set(definition.key, template as unknown as AnyTemplate);
  return template;
}

/** The registered template, or null for an unknown key. */
export function getEmailTemplate(key: string): AnyTemplate | null {
  return registry.get(key) ?? null;
}

export type EmailTemplateInfo = {
  key: string;
  label: string;
  description: string | null;
  audience: AnyTemplate["audience"];
  marketing: boolean;
  placeholders: string[];
};

/** Every registered template (for the panel's template editor), sorted by label. */
export function listEmailTemplates(): EmailTemplateInfo[] {
  return [...registry.values()]
    .map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description ?? null,
      audience: t.audience,
      marketing: Boolean(t.marketing),
      placeholders: [...t.placeholders],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}
