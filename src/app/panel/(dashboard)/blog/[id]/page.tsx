import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import BlogEditor from "@/components/panel/blog/BlogEditor";
import type { BlogEditorState } from "@/components/panel/blog/state";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { siteOrigin } from "@/i18n/paths";
import { getPanelPost, listBlogTags, type PanelPost } from "@/lib/panel/blog/queries";
import { getPanelMedia } from "@/lib/panel/media/queries";
import { getSettings } from "@/lib/settings/get-settings";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yazıyı düzenle" };

type Params = Promise<{ id: string }>;

export default function EditPostPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Editor params={params} />
    </Suspense>
  );
}

function toState(post: PanelPost): BlogEditorState {
  return {
    id: post.id,
    updatedAt: post.updatedAt,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body: post.body,
    coverId: post.coverId,
    authorName: post.authorName,
    tags: post.tags,
    relatedProductIds: post.relatedProductIds,
    status: post.status,
    publishedAt: post.publishedAt,
    seo: post.seo,
  };
}

async function Editor({ params }: { params: Params }) {
  await requireStaff("editor");
  const { id } = await params;
  const postId = /^\d{1,9}$/.test(id) ? Number(id) : NaN;
  const post = Number.isSafeInteger(postId) ? await getPanelPost(postId) : null;
  if (!post) notFound();
  const [tags, seo, media] = await Promise.all([
    listBlogTags(),
    getSettings("seo"),
    getPanelMedia([post.coverId, post.seo.ogImageId].filter((v): v is number => typeof v === "number")),
  ]);
  return <BlogEditor key={post.id} initial={toState(post)} media={media} knownTags={tags} titleTemplate={seo.titleTemplate} siteOrigin={siteOrigin()} />;
}
