"use client";
// "Çıkış yap" in the account navigation: prepareSignOutAction (drops the account's cart cookie), then
// Better Auth's sign-out endpoint, then a full page load to the home page so the header, favorites
// and every viewer island start over signed out.

import { LoaderCircle, LogOut } from "lucide-react";
import { useState, useTransition } from "react";
import { publishCartCount } from "@/components/store/cart-count";
import { prepareSignOutAction } from "@/lib/account/auth-actions";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export default function SignOutButton({ locale, label, pendingLabel, className }: { locale: string; label: string; pendingLabel: string; className?: string }) {
  const [pending, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const busy = pending || leaving;
  return (
    <button
      type="button"
      disabled={busy}
      aria-busy={busy}
      onClick={() =>
        startTransition(async () => {
          const { redirectTo } = await prepareSignOutAction(locale);
          try {
            await authClient.signOut();
          } catch {
            // the full page load below shows the real state either way
          }
          setLeaving(true);
          publishCartCount(0);
          window.location.assign(redirectTo);
        })
      }
      className={cn(
        "inline-flex min-h-11 items-center gap-2.5 rounded-control text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-70",
        className,
      )}
    >
      {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} /> : <LogOut aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />}
      <span>{busy ? pendingLabel : label}</span>
    </button>
  );
}
