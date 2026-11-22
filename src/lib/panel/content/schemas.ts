// Payload schemas for the CONTENT area (pages + sections, menus, announcements). Pure zod: the editors
// validate with them before sending, the Server Actions validate again. Field error paths match the
// editors' state ("sections.2.content.headline.tr", "menus.header.items.0.href").
import { z } from "zod";
import { isSectionType } from "@/components/sections/schemas";
import {
  hrefInput,
  idInput,
  localizedTextOf,
  mediaIdInput,
  optionalHrefInput,
  optionalLocalizedTextOf,
  scheduleInput,
  slugInput,
  updatedAtInput,
} from "@/lib/panel/schemas";
import { ANNOUNCEMENT_TEXT_MAX, ANNOUNCEMENT_VARIANTS } from "./announcements";
import type { MenuKey } from "@/lib/data/site";
import { MAX_MENU_CHILDREN, menuDef } from "./menus";
import { AUDIENCES, normalizeSectionContent } from "./sections";

export const MAX_SECTIONS_PER_PAGE = 40;

// ---------------------------------------------------------------------------------------------------
// Pages and sections

/** One section as the editor sends it. `id` is null for a section added in this edit. */
export const sectionInput = z
  .object({
    id: idInput.nullable().optional(),
    type: z.string({ error: "Bölüm türü eksik." }).trim().min(1, "Bölüm türü eksik."),
    isVisible: z.boolean({ error: "Görünürlük seçin." }),
    audience: z.enum(AUDIENCES, { error: "Kitle seçin." }),
    schedule: scheduleInput,
    content: z.unknown(),
  })
  .transform((section, ctx) => {
    const type = section.type;
    if (!isSectionType(type)) {
      ctx.addIssue({ code: "custom", path: ["type"], message: "Bu bölüm türü tanınmıyor. Bölümü kaldırıp kaydedin." });
      return z.NEVER;
    }
    const result = normalizeSectionContent(type, section.content);
    if (!result.ok) {
      for (const issue of result.issues) ctx.addIssue({ code: "custom", path: ["content", ...issue.path], message: issue.message });
      return z.NEVER;
    }
    return { id: section.id ?? null, type, isVisible: section.isVisible, audience: section.audience, schedule: section.schedule, content: result.content };
  });

export type SectionInput = z.output<typeof sectionInput>;

export const seoInput = z.object({
  title: optionalLocalizedTextOf({ max: 120 }),
  description: optionalLocalizedTextOf({ max: 320 }),
  ogImageId: mediaIdInput,
  noIndex: z.boolean().optional().default(false),
});

export const pageSaveSchema = z.object({
  id: idInput,
  title: localizedTextOf({ max: 120, requiredMessage: "Sayfa başlığını Türkçe girin." }),
  slug: slugInput,
  isPublished: z.boolean(),
  seo: seoInput,
  sections: z
    .array(sectionInput)
    .max(MAX_SECTIONS_PER_PAGE, `Bir sayfada en fazla ${MAX_SECTIONS_PER_PAGE} bölüm olabilir.`),
  updatedAt: updatedAtInput,
});

export type PageSaveInput = z.output<typeof pageSaveSchema>;

export const pageCreateSchema = z.object({
  title: localizedTextOf({ max: 120, requiredMessage: "Sayfa başlığını Türkçe girin." }),
  slug: slugInput,
});

export type PageCreateInput = z.output<typeof pageCreateSchema>;

export const pageDeleteSchema = z.object({ id: idInput, updatedAt: updatedAtInput });

// ---------------------------------------------------------------------------------------------------
// Menus

const menuLink = {
  label: localizedTextOf({ max: 60, requiredMessage: "Bağlantı yazısını Türkçe girin." }),
  href: hrefInput,
  highlight: z.boolean().optional(),
};

const menuChild = z.object(menuLink);
const menuItem = z.object({
  ...menuLink,
  children: z.array(menuChild).max(MAX_MENU_CHILDREN, `En fazla ${MAX_MENU_CHILDREN} alt bağlantı ekleyebilirsiniz.`).optional(),
});

function menuOf(key: MenuKey) {
  const def = menuDef(key);
  const maxItems = def?.maxItems ?? 12;
  const allowChildren = def?.allowChildren ?? false;
  return z.object({
    items: z
      .array(menuItem)
      .max(maxItems, `Bu menüye en fazla ${maxItems} bağlantı ekleyebilirsiniz.`)
      // Only the header has dropdowns; children sent for a footer menu are dropped.
      .transform((items) => (allowChildren ? items : items.map((item) => ({ label: item.label, href: item.href, highlight: item.highlight })))),
    /** null when the menu row does not exist yet. */
    updatedAt: updatedAtInput.nullable(),
  });
}

export const menusSaveSchema = z.object({
  menus: z.object({
    header: menuOf("header"),
    footer_shop: menuOf("footer_shop"),
    footer_corporate: menuOf("footer_corporate"),
    footer_legal: menuOf("footer_legal"),
  }),
});

export type MenusSaveInput = z.output<typeof menusSaveSchema>;

// ---------------------------------------------------------------------------------------------------
// Announcements

export const announcementSaveSchema = z.object({
  /** null → create a new announcement. */
  id: idInput.nullable(),
  text: localizedTextOf({ max: ANNOUNCEMENT_TEXT_MAX, requiredMessage: "Duyuru metnini Türkçe girin." }),
  href: optionalHrefInput,
  variant: z.enum(ANNOUNCEMENT_VARIANTS, { error: "Bir renk seçin." }),
  isActive: z.boolean(),
  schedule: scheduleInput,
  /** null when creating. */
  updatedAt: updatedAtInput.nullable(),
});

export type AnnouncementSaveInput = z.output<typeof announcementSaveSchema>;

export const announcementOrderSchema = z.object({
  ids: z.array(idInput).max(200),
});

export const announcementDeleteSchema = z.object({ id: idInput, updatedAt: updatedAtInput });
