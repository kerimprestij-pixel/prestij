"use server";
// Blog Server Actions (editor+). Business rules live in src/lib/panel/blog/service.ts.
import { panelAction } from "@/lib/panel/action";
import { blogDeleteInput, blogPostInput } from "@/lib/panel/blog/schema";
import { deleteBlogPost, saveBlogPost } from "@/lib/panel/blog/service";

export type SavePostData = { id: number; slug: string; updatedAt: string; status: "draft" | "published"; publishedAt: string | null; created: boolean };

/** Creates (id null) or saves a post; returns the new version so the editor can keep editing. */
export const savePostAction = panelAction<typeof blogPostInput, SavePostData>({
  minRole: "editor",
  schema: blogPostInput,
  run: async (input, { tx }) => {
    const { post, created, tags, audit } = await saveBlogPost(tx, input);
    const message = created
      ? post.status === "published"
        ? "Yazı oluşturuldu ve yayınlandı."
        : "Taslak oluşturuldu."
      : "Yazı kaydedildi.";
    return {
      data: {
        id: post.id,
        slug: post.slug,
        updatedAt: post.updatedAt.toISOString(),
        status: post.status,
        publishedAt: post.publishedAt?.toISOString() ?? null,
        created,
      },
      message,
      tags,
      audit,
    };
  },
});

/** Deletes a post; refused while menus, sections or announcements link to it. */
export const deletePostAction = panelAction({
  minRole: "editor",
  schema: blogDeleteInput,
  run: async (input, { tx }) => {
    const { tags, audit } = await deleteBlogPost(tx, input);
    return { data: { id: input.id }, message: "Yazı silindi.", tags, audit };
  },
});
