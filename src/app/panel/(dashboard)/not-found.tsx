import Link from "next/link";
import { Compass } from "lucide-react";
import EmptyState from "@/components/panel/EmptyState";

export default function PanelNotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-surface py-6">
      <EmptyState
        icon={Compass}
        title="Sayfa bulunamadı"
        description="Aradığınız kayıt silinmiş veya adres hatalı olabilir."
        action={
          <Link
            href="/panel"
            className="inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Genel Bakış&apos;a dön
          </Link>
        }
      />
    </div>
  );
}
