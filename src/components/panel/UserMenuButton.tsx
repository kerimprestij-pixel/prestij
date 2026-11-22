"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ChevronDown, ExternalLink, LoaderCircle, LogOut } from "lucide-react";
import { signOutAction } from "@/app/panel/actions";
import { confirmLeaveDrafts } from "@/components/panel/form/dirty-registry";
import { cn } from "@/lib/utils";
import { initials } from "./labels";

type UserMenuButtonProps = {
  name: string;
  email: string;
  roleLabel: string;
};

function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-start text-sm text-text hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle aria-hidden className="size-4 animate-spin text-text-muted motion-reduce:animate-none" />
      ) : (
        <LogOut aria-hidden className="size-4 text-text-muted" />
      )}
      {pending ? "Çıkış yapılıyor…" : "Çıkış yap"}
    </button>
  );
}

export default function UserMenuButton({ name, email, roleLabel }: UserMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-lg py-1 ps-1 pe-2 text-start transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold tracking-wide text-brand-contrast"
        >
          {initials(name)}
        </span>
        <span className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="max-w-40 truncate text-sm font-medium text-text">{name}</span>
          <span className="text-[0.6875rem] uppercase tracking-[0.14em] text-gold-text">{roleLabel}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 text-text-muted transition-transform motion-reduce:transition-none", open && "rotate-180")}
        />
        <span className="sr-only">Kullanıcı menüsü</span>
      </button>

      <div
        id={menuId}
        role="region"
        aria-label="Kullanıcı menüsü"
        hidden={!open}
        className="absolute end-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-[0_16px_40px_-16px_rgb(3_38_95/0.35)]"
      >
        <div className="border-b border-border px-3 pb-3 pt-2">
          <p className="truncate text-sm font-medium text-text">{name}</p>
          <p className="truncate text-xs text-text-muted">{email}</p>
          <p className="mt-2 inline-flex rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-text">
            {roleLabel}
          </p>
        </div>
        <div className="pt-1.5">
          <a
            href="/tr"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          >
            <ExternalLink aria-hidden className="size-4 text-text-muted" />
            Siteyi görüntüle
          </a>
          <form
            action={signOutAction}
            onSubmit={(event) => {
              // Signing out loses every unsaved draft (also those in routes left with Back).
              if (!confirmLeaveDrafts()) event.preventDefault();
            }}
          >
            <SignOutButton />
          </form>
        </div>
      </div>
    </div>
  );
}
