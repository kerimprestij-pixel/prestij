// A provider's refusal of OUR request (e.g. PayTR get-token answering { status: "failed", reason }), go-live
// CF-12. The reason is the provider's text about the request (wrong field, merchant not live, IP not allowed…),
// never card data: card details are typed into the provider's own page, not sent by this site. Still, it is
// cut to 200 characters and anything that looks like an e-mail address or a long number is masked before it
// is logged or stored in payments.raw.lastError. Pure; unit-tested in tests/unit/golive-payments-email.test.ts
// (also exercised in tests/db/golive-payments.test.ts).

/** Longest provider message kept. */
export const PROVIDER_MESSAGE_MAX = 200;

/** The provider's message, single line, masked (e-mail addresses, runs of 10+ digits) and at most 200 characters. */
export function safeProviderMessage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g, "[e-posta]")
    .replace(/\d(?:[\s.-]?\d){9,}/g, "[numara]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > PROVIDER_MESSAGE_MAX ? `${text.slice(0, PROVIDER_MESSAGE_MAX - 1)}…` : text;
}

/** Thrown by a gateway's initiate() when the provider refuses the request with a reason. */
export class GatewayRefusedError extends Error {
  readonly provider: string;
  /** safeProviderMessage of the provider's reason (may be empty when it gave none). */
  readonly providerMessage: string;

  constructor(provider: string, reason: unknown) {
    const message = safeProviderMessage(reason);
    super(`${provider} refused the request${message ? `: ${message}` : ""}`);
    this.name = "GatewayRefusedError";
    this.provider = provider;
    this.providerMessage = message;
  }
}

/** The provider's refusal reason carried by `error`, or null for any other error (whose message is never logged). */
export function providerRefusalOf(error: unknown): { provider: string; message: string } | null {
  if (!(error instanceof GatewayRefusedError) || !error.providerMessage) return null;
  return { provider: error.provider, message: error.providerMessage };
}
