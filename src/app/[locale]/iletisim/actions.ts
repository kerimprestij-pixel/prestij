"use server";
// Contact form (section `contact_form`). The locale arrives as a hidden field (root params are not
// available in Server Actions); `website` is a honeypot. Limits: 5 per hour per IP, 20 per day per
// e-mail (src/lib/contact/throttle.ts). The panel inbox reads contact_messages uncached, so no tags.

import type { ContactFormState } from "@/lib/contact/types";
import { submitContactForm } from "@/lib/contact/service";
import { clientIp } from "@/lib/request-ip";

export async function sendContactMessage(prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const { state } = await submitContactForm(formData, { ip: await clientIp(), prev });
  return state;
}
