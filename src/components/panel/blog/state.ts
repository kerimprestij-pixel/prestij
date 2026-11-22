// Blog editor state (pure: the server pages build it, the client editor edits it).
import type { LocalizedText } from "@/db/schema/common";

export type BlogEditorState = {
  id: number | null;
  /** ISO; null for a new post. */
  updatedAt: string | null;
  title: LocalizedText;
  slug: string;
  excerpt: LocalizedText | null;
  body: LocalizedText | null;
  coverId: number | null;
  authorName: string;
  tags: string[];
  relatedProductIds: number[];
  status: "draft" | "published";
  /** ISO or null. */
  publishedAt: string | null;
  seo: { title: LocalizedText | null; description: LocalizedText | null; ogImageId: number | null; noIndex: boolean };
};

export function emptyPostState(): BlogEditorState {
  return {
    id: null,
    updatedAt: null,
    title: { tr: "" },
    slug: "",
    excerpt: null,
    body: null,
    coverId: null,
    authorName: "",
    tags: [],
    relatedProductIds: [],
    status: "draft",
    publishedAt: null,
    seo: { title: null, description: null, ogImageId: null, noIndex: false },
  };
}
