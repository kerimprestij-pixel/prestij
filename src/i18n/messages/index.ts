// Built-in dictionaries (no DB overrides). Storefront code should call getMessages(locale) instead;
// this is for the panel's UI-strings editor and for tests.
import type { Locale } from "../config";
import ar from "./ar";
import en from "./en";
import tr, { type Messages } from "./tr";

export type { Messages };

export const defaultMessages: Record<Locale, Messages> = { tr, en, ar };
