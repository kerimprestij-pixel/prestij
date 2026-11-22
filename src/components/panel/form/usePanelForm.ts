"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/panel/ui/toast-store";
import { panelLoginHref, toPayloadFormData, type ActionResult } from "@/lib/panel/action-types";
import type { LocalizedErrors } from "./localized";
import { errorsUnder, getIn, joinPath, looselyEqual, setIn, withoutErrorsUnder, type Path } from "./paths";

/** A panel Server Action made with panelAction(): `(prev, formData) => ActionResult`. */
export type PanelFormAction<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

/** Structural zod-like schema (any zod schema fits) for optional client-side checks before sending. */
export type ClientValidator = {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: readonly PropertyKey[]; message: string }[] } };
};

export type SubmitOptions<V, T> = {
  /** What to send (default: the whole state). Sent as JSON in the "payload" form field. */
  payload?: (state: V) => unknown;
  /** Validate the payload on the client first (e.g. the action's zod schema). Errors map to fields; nothing is sent. */
  validate?: ClientValidator;
  /** Toast on success: a message, or false for none. Default: the action's message, else "Değişiklikler kaydedildi." */
  successMessage?: string | false;
  /** Toast on failure (default true). Field errors are always shown next to the fields. */
  errorToast?: boolean;
  /** New saved state after success. Default: the state that was sent (or fresher server data if it arrived meanwhile). */
  resetTo?: V | ((sent: V, data: T | undefined) => V);
  onSuccess?: (data: T | undefined, result: Extract<ActionResult<T>, { ok: true }>) => void;
  onError?: (result: Extract<ActionResult<T>, { ok: false }>) => void;
};

export type FieldBinding<F> = {
  name: string;
  value: F;
  onChange: (value: F) => void;
  /** Error at this path, or the first one below it. */
  error: string | undefined;
};

export type PanelForm<V> = {
  state: V;
  setState: (next: V | ((prev: V) => V)) => void;
  /** Immutable update at a dotted path ("variants.2.price"); clears that path's errors. */
  setField: (path: Path, value: unknown) => void;
  getField: <F = unknown>(path: Path) => F;
  /** `{ name, value, onChange, error }` for a control at a path. */
  bind: <F = unknown>(path: Path) => FieldBinding<F>;
  /** True when the state differs from the last saved/loaded state. */
  dirty: boolean;
  /** Back to the saved state (or to `next`, which becomes the new saved state). */
  reset: (next?: V) => void;
  /** The last saved/loaded state. */
  saved: V;
  errors: Record<string, string>;
  /** Error at a path, or the first one below it. */
  errorFor: (path: Path) => string | undefined;
  /** Errors below a path, keyed relative to it. */
  errorsUnder: (path: Path) => Record<string, string>;
  /** For LocalizedInput/LocalizedTextarea/LocalizedRichText: a message or { tr, en, ar } messages. */
  localizedError: (path: Path) => LocalizedErrors;
  /** True when a path or anything below it has an error (e.g. to mark a tab). */
  hasErrors: (path: Path) => boolean;
  setErrors: (errors: Record<string, string>) => void;
  pending: boolean;
  /** Sends the state to a panel action as JSON ("payload"), maps field errors back, toasts the outcome. */
  submit: <T>(action: PanelFormAction<T>, options?: SubmitOptions<V, T>) => Promise<ActionResult<T>>;
  /** Attach to the <form> (or wrapper) so the first invalid field is focused after a failed save. */
  formRef: React.RefObject<HTMLFormElement | null>;
};

export type UsePanelFormOptions = {
  /** Default success toast for submit(). */
  successMessage?: string;
};

const NETWORK_ERROR = "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.";
const BUSY_ERROR = "Önceki kayıt işlemi sürüyor.";
const CLIENT_INVALID = "Lütfen işaretli alanları düzeltin.";

function keyOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Editor state for a panel form. Keep the whole record in React state, edit it with setField/bind,
 * then `submit(saveAction)`: the state is posted as JSON in the "payload" field (CORE §1), dotted
 * fieldErrors come back next to the fields, a toast reports the outcome, and the state is kept on failure.
 * When the page re-renders with fresh `initial` data (e.g. after the save), a clean form follows it.
 */
export function usePanelForm<V>(initial: V, options: UsePanelFormOptions = {}): PanelForm<V> {
  const [state, setStateRaw] = useState<V>(initial);
  const [saved, setSaved] = useState<V>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [seenInitial, setSeenInitial] = useState(() => keyOf(initial));
  /** Fresh server data that arrived while a save was in flight (applied when it succeeds). */
  const [arrivedWhilePending, setArrivedWhilePending] = useState<{ value: V } | null>(null);

  const formRef = useRef<HTMLFormElement | null>(null);
  const stateRef = useRef(state);
  const savedRef = useRef(saved);
  const pendingRef = useRef(false);
  const arrivedRef = useRef(arrivedWhilePending);
  const optionsRef = useRef(options);

  const dirty = !looselyEqual(state, saved);

  // The page re-rendered with different initial data (after a save, a refresh, or a navigation).
  const initialKey = keyOf(initial);
  if (initialKey !== seenInitial) {
    setSeenInitial(initialKey);
    if (pending) {
      setArrivedWhilePending({ value: initial });
    } else if (!dirty) {
      setSaved(initial);
      setStateRaw(initial);
      setErrors({});
    } else {
      // Keep the user's edits; "Vazgeç" now returns to the fresh data.
      setSaved(initial);
    }
  }

  useLayoutEffect(() => {
    stateRef.current = state;
    savedRef.current = saved;
    arrivedRef.current = arrivedWhilePending;
    optionsRef.current = options;
  });

  // After a failed save, bring the first invalid (visible) field into view.
  useEffect(() => {
    if (focusRequest === 0) return;
    const root: ParentNode = formRef.current ?? document;
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[aria-invalid="true"]'));
    const target = candidates.find((el) => el.getClientRects().length > 0 && !el.closest("[hidden],[inert]"));
    if (target) {
      target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target.focus({ preventScroll: true });
    }
  }, [focusRequest]);

  const setState = useCallback((next: V | ((prev: V) => V)) => {
    setStateRaw((prev) => (typeof next === "function" ? (next as (p: V) => V)(prev) : next));
  }, []);

  const setField = useCallback((path: Path, value: unknown) => {
    setStateRaw((prev) => setIn(prev, path, value));
    setErrors((prev) => withoutErrorsUnder(prev, path));
  }, []);

  const reset = useCallback((next?: V) => {
    if (next !== undefined) {
      setSaved(next);
      setStateRaw(next);
    } else {
      setStateRaw(savedRef.current);
    }
    setErrors({});
  }, []);

  const submit = useCallback(async <T,>(action: PanelFormAction<T>, opts: SubmitOptions<V, T> = {}): Promise<ActionResult<T>> => {
    if (pendingRef.current) return { ok: false, error: BUSY_ERROR, code: "server" };
    const sent = stateRef.current;
    const payload = opts.payload ? opts.payload(sent) : sent;

    if (opts.validate) {
      const parsed = opts.validate.safeParse(payload);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error?.issues ?? []) {
          const key = joinPath(issue.path);
          if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
        }
        setErrors(fieldErrors);
        setFocusRequest((n) => n + 1);
        if (opts.errorToast !== false) toast.error(CLIENT_INVALID);
        const result = { ok: false as const, error: CLIENT_INVALID, code: "invalid" as const, fieldErrors };
        opts.onError?.(result);
        return result;
      }
    }

    pendingRef.current = true;
    setPending(true);
    setArrivedWhilePending(null);
    let result: ActionResult<T>;
    try {
      result = await action(null, toPayloadFormData(payload));
      if (!result || typeof result !== "object" || !("ok" in result)) throw new Error("bad result");
    } catch {
      result = { ok: false, error: NETWORK_ERROR, code: "server" };
    }
    pendingRef.current = false;
    setPending(false);
    const arrived = arrivedRef.current;
    setArrivedWhilePending(null);

    if (result.ok) {
      const nextSaved =
        opts.resetTo !== undefined
          ? typeof opts.resetTo === "function"
            ? (opts.resetTo as (s: V, d: T | undefined) => V)(sent, result.data)
            : opts.resetTo
          : arrived
            ? arrived.value
            : sent;
      setSaved(nextSaved);
      // Edits made while saving stay (and stay dirty); otherwise show the saved state.
      setStateRaw((current) => (current === sent ? nextSaved : current));
      setErrors({});
      const message = opts.successMessage === false ? null : (result.message ?? opts.successMessage ?? optionsRef.current.successMessage ?? "Değişiklikler kaydedildi.");
      if (message) toast.success(message);
      opts.onSuccess?.(result.data, result);
    } else {
      if (arrived) setSaved(arrived.value);
      setErrors(result.fieldErrors ?? {});
      if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) setFocusRequest((n) => n + 1);
      if (result.sessionExpired) {
        // Always shown (the draft is still here): sign in in a new tab, then save again.
        toast.error(result.error, {
          duration: 0,
          action: {
            label: "Yeni sekmede giriş yap",
            onClick: () => window.open(panelLoginHref(window.location.pathname + window.location.search), "_blank", "noopener"),
          },
        });
      } else if (opts.errorToast !== false) {
        toast.error(result.error, result.code === "conflict" ? { action: { label: "Sayfayı yenile", onClick: () => window.location.reload() }, duration: 0 } : undefined);
      }
      opts.onError?.(result);
    }
    return result;
  }, []);

  const errorFor = useCallback(
    (path: Path) => {
      const under = errorsUnder(errors, path);
      return under[""] ?? Object.values(under)[0];
    },
    [errors],
  );

  return useMemo<PanelForm<V>>(
    () => ({
      state,
      setState,
      setField,
      getField: <F,>(path: Path) => getIn(state, path) as F,
      bind: <F,>(path: Path): FieldBinding<F> => ({
        name: typeof path === "string" ? path : joinPath(path),
        value: getIn(state, path) as F,
        onChange: (value: F) => setField(path, value),
        error: errorFor(path),
      }),
      dirty,
      reset,
      saved,
      errors,
      errorFor,
      errorsUnder: (path: Path) => errorsUnder(errors, path),
      localizedError: (path: Path): LocalizedErrors => {
        const under = errorsUnder(errors, path);
        if (under[""]) return under[""];
        const out: Partial<Record<"tr" | "en" | "ar", string>> = {};
        for (const locale of ["tr", "en", "ar"] as const) if (under[locale]) out[locale] = under[locale];
        return Object.keys(out).length > 0 ? out : undefined;
      },
      hasErrors: (path: Path) => Object.keys(errorsUnder(errors, path)).length > 0,
      setErrors,
      pending,
      submit,
      formRef,
    }),
    [state, setState, setField, dirty, reset, saved, errors, errorFor, pending, submit],
  );
}

export default usePanelForm;
