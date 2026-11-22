// Guard for the panel's test sends (campaign test: editor+, template test: admin). A test send puts
// panel-written content on the shop's verified sending domain, so it goes only to the sender's own
// address or the shop's notification recipients unless an admin sends it, and every user may send at
// most TEST_SEND_RULE per hour (durable limit; the recipient never goes into the audit log).
import "server-only";
import { adminRecipients } from "@/lib/email";
import { PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import type { RateRule } from "@/lib/rate-limit";
import { consumeLimits } from "@/lib/rate-limit-store";
import type { StaffRole } from "@/lib/session";

export const TEST_SEND_RULE: RateRule = { limit: 20, windowMs: 60 * 60 * 1000 };

export const testSendLimitKey = (userId: string) => `email-test:user:${userId}`;

/** Throws a PanelError (field `to`) when this actor may not send a test to `to` now; consumes one send otherwise. */
export async function guardTestSend(tx: Tx, actor: { userId: string; email: string; role: StaffRole }, to: string): Promise<void> {
  const target = to.trim().toLowerCase();
  if (actor.role !== "admin") {
    const allowed = new Set([actor.email.trim().toLowerCase(), ...(await adminRecipients(tx)).map((r) => r.trim().toLowerCase())]);
    if (!allowed.has(target)) {
      const message = "Test e-postasını yalnızca kendi adresinize veya bildirim alıcılarına gönderebilirsiniz.";
      throw new PanelError("invalid", message, { to: message });
    }
  }
  const decision = await consumeLimits([[testSendLimitKey(actor.userId), TEST_SEND_RULE]], { executor: tx });
  if (!decision.allowed) {
    const message = `Saatte en fazla ${TEST_SEND_RULE.limit} test e-postası gönderebilirsiniz. ${decision.retryAfterMinutes} dakika sonra tekrar deneyin.`;
    throw new PanelError("invalid", message, { to: message });
  }
}
