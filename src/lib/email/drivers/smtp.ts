// SMTP driver (nodemailer). EMAIL_SMTP_URL, e.g. smtps://user:pass@smtp.example.com:465. The URL holds
// credentials: it is never logged, stored or shown (the panel only says "tanımlı / tanımlı değil").
import nodemailer from "nodemailer";
import type { EmailDriver } from "./types";

type Transport = ReturnType<typeof nodemailer.createTransport>;

const globalSmtp = globalThis as typeof globalThis & { __prestijSmtp?: { url: string; transport: Transport } };

function transportFor(url: string): Transport {
  const cached = globalSmtp.__prestijSmtp;
  if (cached && cached.url === url) return cached.transport;
  cached?.transport.close();
  const transport = nodemailer.createTransport(url, {
    // Mails carry no attachments; never let a message read local files or fetch URLs.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  globalSmtp.__prestijSmtp = { url, transport };
  return transport;
}

export function createSmtpDriver(url: string): EmailDriver {
  return {
    name: "smtp",
    async send(message) {
      const info = await transportFor(url).sendMail({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo ?? undefined,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      });
      return { messageId: typeof info.messageId === "string" ? info.messageId : null };
    },
  };
}
