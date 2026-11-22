// Server half of the category editor (edit and "new" pages): loads the context the editor needs.
import "server-only";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { siteOrigin } from "@/i18n/paths";
import type { CategoryEditorState } from "@/lib/panel/categories/schema";
import { listPanelCategories } from "@/lib/panel/categories/service";
import { getPanelMedia } from "@/lib/panel/media/queries";
import { getSettings } from "@/lib/settings/get-settings";
import CategoryEditor from "./CategoryEditor";

export function CategoriesBackLink() {
  return (
    <Link
      href="/panel/kategoriler"
      className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
      Kategoriler
    </Link>
  );
}

export default async function CategoryEditorView({ state }: { state: CategoryEditorState }) {
  const [all, seo, general, media] = await Promise.all([
    listPanelCategories(),
    getSettings("seo"),
    getSettings("general"),
    getPanelMedia([state.imageId, state.seo.ogImageId].filter((m): m is number => m !== null)),
  ]);
  const titleTemplate = seo.titleTemplate.includes("%s") ? seo.titleTemplate : `%s | ${general.siteName}`;
  const own = all.find((c) => c.id === state.id);
  return (
    <CategoryEditor
      initial={state}
      media={media}
      productCount={own?.productCount ?? 0}
      others={all.filter((c) => c.id !== state.id).map((c) => ({ id: c.id, name: c.name }))}
      titleTemplate={titleTemplate}
      siteUrl={siteOrigin()}
    />
  );
}
