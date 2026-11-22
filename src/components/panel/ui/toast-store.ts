// Tiny toast store shared by <Toaster/> (mounted once in the panel shell) and any client code.
// No React context: `toast.success("…")` works from event handlers, hooks and plain functions.

export type ToastTone = "success" | "error" | "info" | "warning";

export type ToastAction = { label: string; onClick: () => void };

export type ToastItem = {
  id: number;
  tone: ToastTone;
  message: string;
  description?: string;
  /** Milliseconds before it hides on its own; 0 = stays until dismissed. */
  duration: number;
  action?: ToastAction;
};

export type ToastOptions = {
  description?: string;
  duration?: number;
  action?: ToastAction;
  /** Replace an existing toast with the same id (e.g. "Yükleniyor…" → "Yüklendi"). */
  id?: number;
};

const MAX_TOASTS = 4;
const DEFAULT_DURATION: Record<ToastTone, number> = { success: 4500, info: 5000, warning: 7000, error: 8000 };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): ToastItem[] {
  return items;
}

export function getServerToasts(): ToastItem[] {
  return EMPTY;
}

function show(tone: ToastTone, message: string, options: ToastOptions = {}): number {
  const id = options.id ?? nextId++;
  const item: ToastItem = {
    id,
    tone,
    message,
    description: options.description,
    duration: options.duration ?? DEFAULT_DURATION[tone],
    action: options.action,
  };
  const existing = items.findIndex((t) => t.id === id);
  items = existing >= 0 ? items.map((t) => (t.id === id ? item : t)) : [...items, item].slice(-MAX_TOASTS);
  emit();
  return id;
}

export function dismissToast(id: number): void {
  const next = items.filter((t) => t.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

export function clearToasts(): void {
  if (items.length) {
    items = [];
    emit();
  }
}

type ToastFn = ((message: string, options?: ToastOptions & { tone?: ToastTone }) => number) & {
  success: (message: string, options?: ToastOptions) => number;
  error: (message: string, options?: ToastOptions) => number;
  info: (message: string, options?: ToastOptions) => number;
  warning: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
};

/** `toast("…")`, `toast.success("Kaydedildi")`, `toast.error("…")`; returns the toast id. */
export const toast: ToastFn = Object.assign(
  (message: string, options?: ToastOptions & { tone?: ToastTone }) => show(options?.tone ?? "info", message, options),
  {
    success: (message: string, options?: ToastOptions) => show("success", message, options),
    error: (message: string, options?: ToastOptions) => show("error", message, options),
    info: (message: string, options?: ToastOptions) => show("info", message, options),
    warning: (message: string, options?: ToastOptions) => show("warning", message, options),
    dismiss: dismissToast,
  },
);
