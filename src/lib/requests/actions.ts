"use server";
// Storefront Server Actions of the quote and sample forms (sections `quote_form`,
// `sample_request_form`). The locale arrives as a hidden field (root params are not available in
// Server Actions); `website` is a honeypot; limits in ./throttle.ts. The panel lists read the tables
// uncached, so no tags. The pages stay static: the session is read only here, after hydration.

import { getSession } from "@/lib/session";
import { clientIp } from "@/lib/request-ip";
import { requestPrefillFor, submitQuoteRequest, submitSampleRequest } from "./service";
import type { RequestFormState, RequestPrefill } from "./types";

async function signedInUserId(): Promise<string | null> {
  try {
    const session = await getSession();
    return session?.user && !session.user.banned ? session.user.id : null;
  } catch {
    return null;
  }
}

export async function sendQuoteRequest(prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const { state } = await submitQuoteRequest(formData, { ip: await clientIp(), userId: await signedInUserId(), prev });
  return state;
}

export async function sendSampleRequest(prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const { state } = await submitSampleRequest(formData, { ip: await clientIp(), userId: await signedInUserId(), prev });
  return state;
}

/** The signed-in visitor's own name, e-mail, phone and company for the forms; null when signed out. */
export async function loadRequestPrefill(): Promise<RequestPrefill | null> {
  const userId = await signedInUserId();
  if (!userId) return null;
  try {
    return await requestPrefillFor(userId);
  } catch {
    return null;
  }
}
