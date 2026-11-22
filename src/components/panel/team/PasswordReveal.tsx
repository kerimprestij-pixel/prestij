"use client";
// One-time password display after "create user" / "reset password". The password lives only in this
// component's props until the dialog closes; it is never stored, logged or shown again. Only the explicit
// button closes the dialog, so Escape or a stray click cannot lose it.
import { useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import CopyButton from "@/components/panel/orders/CopyButton";
import { Button, Dialog } from "@/components/panel/ui";

export type RevealedPassword = {
  kind: "created" | "reset";
  name: string;
  email: string;
  password: string;
  /** The admin's own account (reset). */
  self: boolean;
};

export default function PasswordReveal({ value, onClose }: { value: RevealedPassword | null; onClose: () => void }) {
  return value ? <Reveal key={`${value.email}:${value.password}`} value={value} onClose={onClose} /> : null;
}

function Reveal({ value, onClose }: { value: RevealedPassword; onClose: () => void }) {
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const loginUrl = `${origin}/panel/giris`;
  const credentials = `Panel: ${loginUrl}\nE-posta: ${value.email}\nŞifre: ${value.password}`;

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={false}
      hideCloseButton
      role="alertdialog"
      title={value.kind === "created" ? "Hesap oluşturuldu" : value.self ? "Yeni şifreniz" : "Yeni şifre oluşturuldu"}
      description={value.self ? value.email : `${value.name} · ${value.email}`}
      size="sm"
      footer={
        <Button variant="primary" onClick={onClose}>
          Kaydettim, kapat
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2.5 rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2.5 text-sm text-text">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[#B5730C]" />
          <span>
            Bu şifre yalnızca şimdi gösterilir; hiçbir yerde saklanmaz.{" "}
            {value.self
              ? "Bir şifre yöneticisine kaydedin."
              : "Kullanıcıya güvenli bir yoldan iletin (yüz yüze veya uçtan uca şifreli mesajla)."}
          </span>
        </p>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Şifre</p>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-surface-2/60 p-2 ps-3">
            <KeyRound aria-hidden className="size-4 shrink-0 text-gold-text" />
            <code
              dir="ltr"
              translate="no"
              className="min-w-0 flex-1 select-all break-all font-mono text-base tracking-wide text-text"
              data-testid="one-time-password"
            >
              {value.password}
            </code>
            <CopyButton text={value.password} label="Kopyala" srLabel="Şifreyi kopyala" />
          </div>
        </div>
        {value.self ? null : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-muted">
            <span>Giriş adresi, e-posta ve şifre birlikte:</span>
            <CopyButton text={credentials} label="Giriş bilgilerini kopyala" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
