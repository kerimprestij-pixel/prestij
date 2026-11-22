// Local driver: writes each mail to storage/mail-outbox/<timestamp>-<template>-<id>.html | .txt | .json
// instead of sending it (the default outside production). Open the .html in a browser to review.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmailDriver, OutgoingEmail } from "./types";

/** EMAIL_OUTBOX_DIR overrides the folder (tests use a temporary one). */
export function outboxDirectory(): string {
  return process.env.EMAIL_OUTBOX_DIR?.trim() || path.join(process.cwd(), "storage", "mail-outbox");
}

/** "20261110T091530123Z": sortable, no characters that Windows file names refuse. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, "");
}

/** The three file names (without folder) a message is written to. */
export function outboxFileBase(message: Pick<OutgoingEmail, "id" | "template">, now = new Date()): string {
  const template = message.template.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60) || "mail";
  return `${stamp(now)}-${template}-${message.id}`;
}

export function createOutboxDriver(options: { dir?: string } = {}): EmailDriver {
  return {
    name: "outbox",
    async send(message) {
      const dir = options.dir ?? outboxDirectory();
      await mkdir(dir, { recursive: true });
      const base = path.join(dir, outboxFileBase(message));
      const header = {
        id: message.id,
        template: message.template,
        locale: message.locale,
        to: message.to,
        from: message.from,
        replyTo: message.replyTo,
        subject: message.subject,
        headers: message.headers,
        writtenAt: new Date().toISOString(),
      };
      await Promise.all([
        writeFile(`${base}.html`, message.html, "utf8"),
        writeFile(`${base}.txt`, message.text, "utf8"),
        writeFile(`${base}.json`, `${JSON.stringify(header, null, 2)}\n`, "utf8"),
      ]);
      return { messageId: `outbox-${message.id}` };
    },
  };
}
