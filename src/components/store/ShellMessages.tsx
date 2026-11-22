"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";

/** The few UI strings client-only shell parts need (error boundary). Provided by the [locale] layout. */
export type ShellMessages = {
  locale: Locale;
  homeHref: string;
  errors: { generic: string; genericDescription: string; retry: string; goHome: string };
};

const ShellMessagesContext = createContext<ShellMessages | null>(null);

export function ShellMessagesProvider({ value, children }: { value: ShellMessages; children: ReactNode }) {
  return <ShellMessagesContext value={value}>{children}</ShellMessagesContext>;
}

export function useShellMessages(): ShellMessages | null {
  return useContext(ShellMessagesContext);
}
