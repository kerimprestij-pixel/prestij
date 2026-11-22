// Contact form state shared by the server action and the client form. Type-only + constants (pure).
import type { ContactSubject } from "./subjects";

export type ContactField = "name" | "email" | "phone" | "subject" | "message";

/** Field error codes; the client turns them into localized text (messages.contact / messages.errors). */
export type ContactFieldError = "required" | "invalid_name" | "invalid_email" | "invalid_phone" | "too_short" | "too_long";

export type ContactFormValues = { name: string; email: string; phone: string; subject: string; message: string };

/** useActionState state. Start with INITIAL_CONTACT_STATE. */
export type ContactFormState = {
  status: "idle" | "success" | "error";
  /** invalid: see fieldErrors · too_many: rate limit (retryMinutes) · server: storing failed. */
  error?: "invalid" | "too_many" | "server";
  fieldErrors?: Partial<Record<ContactField, ContactFieldError>>;
  retryMinutes?: number;
  /** The submitted values, echoed after an error so the form can be refilled (never after success). */
  values?: ContactFormValues;
  /** Increases with every submission (lets the client remount the fields with the echoed values). */
  attempt: number;
};

export const INITIAL_CONTACT_STATE: ContactFormState = { status: "idle", attempt: 0 };

export const CONTACT_LIMITS = {
  nameMin: 2,
  name: 120,
  email: 254,
  phone: 30,
  messageMin: 10,
  message: 5000,
} as const;

export type ContactInput = {
  name: string;
  email: string;
  /** Normalized (+905… for Turkish mobiles), or null when not given. */
  phone: string | null;
  subject: ContactSubject;
  message: string;
  locale: "tr" | "en" | "ar";
};
