// The register form's optional newsletter box (go-live SR-1). Pure: no imports, unit-tested in
// tests/unit/salesready-impl-a.test.ts; recordNewAccount (./registration.ts) and registerAction use it.
//
// The box is shown only while the newsletter is on (settings.newsletter.enabled; off until İYS). The server
// re-checks the setting: with the newsletter off a ticked box (a stale page or a forged request) is ignored,
// nothing is subscribed and the audit row records marketingRequested: false.

/** What became of the box, stored in the new account's audit row (`newsletter`). */
export type RegisterNewsletterOutcome =
  /** Newsletter switched off: the box was not offered, a submitted value was ignored. */
  | "off"
  /** Offered, not ticked. */
  | "not_requested"
  /** subscribeNewsletter accepted the request: a new or refreshed pending row and a confirmation mail. */
  | "pending"
  /** subscribeNewsletter accepted it without a new mail: already confirmed, or a mail went out under a minute ago. */
  | "already_active"
  | "throttled"
  /** subscribeNewsletter refused (switched off meanwhile, or an address it does not accept). */
  | "disabled"
  | "invalid_email"
  /** The subscription threw (logged); the account and its consent record stay. */
  | "failed";

/** True when the newsletter is on and the box was ticked: the only case that starts the double opt-in. */
export function registerNewsletterRequested(input: { newsletterEnabled: boolean; ticked: boolean }): boolean {
  return input.newsletterEnabled && input.ticked;
}

/**
 * Whether the success screen adds "we also sent a confirmation e-mail for your newsletter subscription"
 * (auth.register.successMarketing) for a brand-new account: only when the newsletter service accepted
 * the request. Never with the newsletter off, an unticked box, a refusal or an error. Its ok outcomes get
 * the same answer (the service's rule: no enumeration of known subscribers). An address that already had
 * an account gets the answer a new account normally gets (registerAction: the requested flag), since the
 * register form never reveals whether an address is registered.
 */
export function registerMarketingNotice(outcome: RegisterNewsletterOutcome): boolean {
  return outcome === "pending" || outcome === "already_active" || outcome === "throttled";
}

/**
 * The `marketing` flag of registerAction's success state, composed in one place (FIX F11, unit-tested):
 * - an address that already had an account: the answer a brand-new account normally gets for the same form
 *   (registerNewsletterRequested: newsletter on and box ticked), so the form never reveals a registration;
 * - a brand-new account: registerMarketingNotice of what recordNewAccount reported, or false when the
 *   post-sign-up records could not run (`newAccountOutcome` null).
 * The raw form field alone never decides it.
 */
export function registerSuccessMarketing(input: {
  existedBefore: boolean;
  newsletterEnabled: boolean;
  ticked: boolean;
  newAccountOutcome: RegisterNewsletterOutcome | null;
}): boolean {
  if (input.existedBefore) return registerNewsletterRequested({ newsletterEnabled: input.newsletterEnabled, ticked: input.ticked });
  return input.newAccountOutcome !== null && registerMarketingNotice(input.newAccountOutcome);
}
