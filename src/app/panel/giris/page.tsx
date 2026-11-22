import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import LoginForm from "@/components/panel/LoginForm";
import { Skeleton } from "@/components/panel/Skeleton";
import Wordmark from "@/components/panel/Wordmark";
import { getSession, staffRoleOf } from "@/lib/session";

export const metadata: Metadata = { title: "Giriş" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Only in-panel destinations are allowed after login (no open redirects). */
function safeNext(value: string | undefined): string {
  if (!value || value.startsWith("//") || value.includes("\\")) return "/panel";
  const inPanel = value === "/panel" || value.startsWith("/panel/") || value.startsWith("/panel?");
  const isLogin = value === "/panel/giris" || value.startsWith("/panel/giris?") || value.startsWith("/panel/giris/");
  return inPanel && !isLogin ? value : "/panel";
}

export default function PanelLoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <BrandPanel />
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-12 lg:hidden">
            <Wordmark caption="Yönetim Paneli" />
          </div>
          <p className="eyebrow">Yönetim Paneli</p>
          <h1 className="mt-2 font-heading text-4xl font-medium leading-tight text-text">Tekrar hoş geldiniz</h1>
          <p className="mt-2 text-sm text-text-muted">Devam etmek için panel hesabınızla giriş yapın.</p>
          <div className="mt-8">
            <Suspense fallback={<LoginFormSkeleton />}>
              <LoginGate searchParams={searchParams} />
            </Suspense>
          </div>
          <p className="mt-10 border-t border-border pt-6 text-xs leading-relaxed text-text-muted">
            Şifrenizi mi unuttunuz? Hesabınızı yeniden etkinleştirmek için site yöneticisiyle iletişime geçin.
          </p>
        </div>
      </main>
    </div>
  );
}

/** Already signed-in staff skip the form. */
async function LoginGate({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNext(first(params.next));
  const session = await getSession();
  if (session && !session.user.banned && staffRoleOf(session.user.role)) redirect(next);
  return <LoginForm next={next} initialError={first(params.hata) === "yetki" ? "forbidden" : null} />;
}

function LoginFormSkeleton() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Yükleniyor…</span>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  );
}

/** Decorative navy panel (fixed brand colors so it looks the same in light and dark mode). */
function BrandPanel() {
  return (
    <aside
      aria-hidden
      className="relative hidden overflow-hidden bg-[#03265F] lg:flex lg:flex-col lg:justify-between lg:p-14"
      style={{
        backgroundImage:
          "radial-gradient(120% 80% at 0% 0%, #14284B 0%, transparent 60%), radial-gradient(90% 70% at 100% 100%, rgb(221 168 42 / 0.16) 0%, transparent 60%)",
      }}
    >
      <div className="absolute inset-y-0 end-14 w-px bg-linear-to-b from-transparent via-[#DDA82A]/40 to-transparent" />
      <div className="absolute -bottom-40 -start-40 size-[32rem] rounded-full border border-[#DDA82A]/15" />
      <div className="absolute -bottom-24 -start-24 size-[24rem] rounded-full border border-[#DDA82A]/10" />

      <Wordmark caption="Yönetim Paneli" size="lg" inverted />

      <div className="relative max-w-md">
        <p className="font-heading text-3xl leading-snug text-[#F9F8F5]">
          Ürünler, siparişler ve mağazanın tüm içeriği tek bir yerde.
        </p>
        <div className="mt-6 h-px w-16 bg-[#DDA82A]" />
        <p className="mt-6 text-xs uppercase tracking-[0.3em] text-[#DDA82A]">Kayseri · Türkiye</p>
      </div>
    </aside>
  );
}
