"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleExclamationPoint, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/** Mirrors STAFF_ROLES in src/lib/session.ts (the server re-checks on every panel request). */
const PANEL_ROLES = ["admin", "editor", "staff"];

const MESSAGES = {
  required: "E-posta ve şifrenizi girin.",
  invalid: "E-posta veya şifre hatalı.",
  forbidden: "Bu hesabın yönetim paneline erişim yetkisi yok.",
  banned: "Bu hesap askıya alınmış. Lütfen bir yöneticiyle iletişime geçin.",
  rateLimited: "Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.",
  unverified: "Bu hesabın e-posta adresi henüz doğrulanmamış. Adresinize bir doğrulama bağlantısı gönderildi; bağlantıyı açtıktan sonra tekrar giriş yapın.",
  network: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.",
  generic: "Giriş yapılamadı. Lütfen tekrar deneyin.",
} as const;

type AuthError = { status?: number; code?: string };

function messageFor(error: AuthError): string {
  if (error.status === 429) return MESSAGES.rateLimited;
  if (error.code === "BANNED_USER") return MESSAGES.banned;
  // Better Auth refuses unverified e-mails with 403 (staff accounts are created verified).
  if (error.code === "EMAIL_NOT_VERIFIED") return MESSAGES.unverified;
  if (error.status === 401 || error.code === "INVALID_EMAIL_OR_PASSWORD") return MESSAGES.invalid;
  return MESSAGES.generic;
}

function isPanelRole(role: unknown): boolean {
  return typeof role === "string" && role.split(",").some((r) => PANEL_ROLES.includes(r.trim()));
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-sm text-text placeholder:text-text-muted/70 transition-[border-color,box-shadow] focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20 aria-[invalid=true]:border-[#C2413A] motion-reduce:transition-none";

type LoginFormProps = {
  /** Safe in-panel path to open after signing in. */
  next: string;
  initialError?: "forbidden" | null;
};

export default function LoginForm({ next, initialError = null }: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ? MESSAGES[initialError] : null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError(MESSAGES.required);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const { data, error: authError } = await authClient.signIn.email({ email, password, rememberMe: true });
      if (authError) {
        setError(messageFor(authError));
        setPending(false);
        return;
      }
      if (!isPanelRole(data?.user?.role)) {
        await authClient.signOut();
        setError(MESSAGES.forbidden);
        setPending(false);
        return;
      }
      // Keep the pending state while the dashboard loads.
      router.replace(next);
      router.refresh();
    } catch {
      setError(MESSAGES.network);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-describedby={error ? "login-error" : undefined}>
      {error ? (
        <div
          id="login-error"
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-[#C2413A]/30 bg-[#C2413A]/[0.07] px-3.5 py-3 text-sm text-text"
        >
          <CircleExclamationPoint aria-hidden className="mt-0.5 size-4 shrink-0 text-[#C2413A]" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="login-email" className="block text-sm font-medium text-text">
          E-posta
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          placeholder="ornek@prestij.com.tr"
          aria-invalid={error === MESSAGES.invalid || undefined}
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="login-password" className="block text-sm font-medium text-text">
          Şifre
        </label>
        <div className="relative">
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            aria-invalid={error === MESSAGES.invalid || undefined}
            className={cn(inputClass, "pe-11")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
            aria-controls="login-password"
            className="absolute inset-y-0 end-0 grid w-11 place-items-center rounded-e-lg text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ring"
          >
            {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            <span className="sr-only">{showPassword ? "Şifreyi gizle" : "Şifreyi göster"}</span>
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium tracking-wide text-brand-contrast transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
        {pending ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}
