// What a driver sends: one stored email_messages row plus the envelope (from / reply-to) built at
// send time from settings and EMAIL_FROM.

export type OutgoingEmail = {
  id: number;
  template: string;
  locale: string;
  to: string;
  /** Formatted From header, e.g. `"PRESTİJ" <siparis@prestij.com.tr>`. */
  from: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  /** Extra headers stored with the message (List-Unsubscribe…). */
  headers: Record<string, string>;
};

export type EmailSendResult = { messageId?: string | null };

export interface EmailDriver {
  readonly name: string;
  /** Throws on failure (the queue records a short, secret-free reason and retries). */
  send(message: OutgoingEmail): Promise<EmailSendResult>;
}

export type EmailDriverName = "outbox" | "smtp" | "none";

export type EmailDriverStatus = {
  /** "none": nothing configured (production without SMTP): mails stay queued. */
  driver: EmailDriverName;
  ready: boolean;
  /** The From address mails go out with (no credentials). */
  fromAddress: string | null;
  /** Turkish explanation for the panel when not ready. */
  problem: string | null;
};
