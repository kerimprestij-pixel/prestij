import type { Metadata } from "next";
import { Suspense } from "react";
import BlogEditor from "@/components/panel/blog/BlogEditor";
import { emptyPostState } from "@/components/panel/blog/state";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import { siteOrigin } from "@/i18n/paths";
import { listBlogTags } from "@/lib/panel/blog/queries";
import { getSettings } from "@/lib/settings/get-settings";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Yeni yazı" };

/** A blank editor; nothing is stored until the first save (then it continues at /panel/blog/<id>). */
export default function NewPostPage() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <NewPost />
    </Suspense>
  );
}

async function NewPost() {
  await requireStaff("editor");
  const [tags, seo] = await Promise.all([listBlogTags(), getSettings("seo")]);
  return <BlogEditor initial={emptyPostState()} knownTags={tags} titleTemplate={seo.titleTemplate} siteOrigin={siteOrigin()} />;
}
