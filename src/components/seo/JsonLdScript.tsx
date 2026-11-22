// Prints one JSON-LD document. The only way the src/components/seo/* components put structured data on
// a page: jsonLd() escapes "<", U+2028 and U+2029, so no value can close the <script> early.
import { jsonLd } from "@/components/store/format";
import type { JsonLdDocument } from "@/lib/seo/structured-data";

/** `<script type="application/ld+json">` for `data`, or nothing when `data` is null. */
export default function JsonLdScript({ data }: { data: JsonLdDocument | null | undefined }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
