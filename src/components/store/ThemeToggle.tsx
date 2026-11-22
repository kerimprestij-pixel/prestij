"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  nextThemeMode,
  readThemeMode,
  setThemeMode,
  type ThemeMode,
} from "@/lib/theme/mode";

export type ThemeToggleLabels = Record<ThemeMode, string>;

type ThemeToggleProps = {
  /** Names of the three modes (messages `theme.light|dark|system`). */
  labels: ThemeToggleLabels;
  /** Optional prefix for the accessible name, e.g. messages `header.theme` → "Tema: Koyu". */
  label?: string;
  className?: string;
};

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

// The server cannot know the stored preference: render a neutral icon until hydrated (no mismatch).
const getServerSnapshot = (): ThemeMode | null => null;

/** Cycles light → dark → system. The icon shows the current preference. */
export default function ThemeToggle({ labels, label, className }: ThemeToggleProps) {
  const mode = useSyncExternalStore<ThemeMode | null>(subscribe, readThemeMode, getServerSnapshot);
  const Icon = mode ? ICONS[mode] : SunMoon;
  const name = mode ? (label ? `${label}: ${labels[mode]}` : labels[mode]) : (label ?? labels.system);

  return (
    <button
      type="button"
      onClick={() => setThemeMode(nextThemeMode(mode ?? "system"))}
      aria-label={name}
      title={name}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-text",
        "transition-colors duration-300 ease-luxe hover:bg-surface-2 hover:text-brand",
        className,
      )}
    >
      <Icon key={mode ?? "pending"} aria-hidden="true" strokeWidth={1.5} className="size-[1.125rem] motion-safe:animate-fade-in" />
    </button>
  );
}
