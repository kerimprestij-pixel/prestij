// Post-commit side effects of order writes. They run only after the DB transaction committed, and a
// failure here never turns a committed order into an error response (logged instead).
import "server-only";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { TAGS } from "@/lib/cache-tags";
import { safeErrorInfo } from "@/lib/db-errors";
import { notifyOrderEvent, type OrderNotificationType } from "@/lib/notifications";

/** Stock changed: product pages (stock badges) regenerate on their next request. */
export function revalidateProducts(slugs: Iterable<string>): void {
  for (const slug of new Set(slugs)) {
    try {
      revalidateTag(TAGS.product(slug), "max");
    } catch (error) {
      console.error("[orders] revalidateTag failed", slug, safeErrorInfo(error));
    }
  }
}

/** Runs the notification hook after the response is sent. */
export function scheduleNotification(type: OrderNotificationType, orderId: number): void {
  try {
    after(() => notifyOrderEvent(type, orderId));
  } catch {
    // Outside a request scope (scripts): notify inline instead.
    void notifyOrderEvent(type, orderId);
  }
}
