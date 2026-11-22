// useActionState state of submitBusinessApplicationAction (type-only module, shared with the client form).
export type BusinessFormState = {
  status: "idle" | "error";
  /** Increments on every failed submit (the form focuses the first error each time). */
  attempt: number;
  /** Localized message for the whole form. */
  formError?: string;
  /** Field path ("address.city") → localized message. */
  fieldErrors?: Record<string, string>;
  /** What was submitted, to refill the inputs after an error. */
  values?: Record<string, string>;
};

export const INITIAL_BUSINESS_FORM_STATE: BusinessFormState = { status: "idle", attempt: 0 };
