// Errors thrown by the account services (src/lib/account/*). Pure. The storefront actions turn the
// code into a localized message (messages.account.errors.<code>); "not_found" is also what another
// customer's id gets, so ownership is never revealed.
export type AccountErrorCode = "not_found" | "limit" | "forbidden" | "invalid";

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(code);
    this.name = "AccountError";
  }
}

export function isAccountError(error: unknown): error is AccountError {
  return error instanceof AccountError;
}
