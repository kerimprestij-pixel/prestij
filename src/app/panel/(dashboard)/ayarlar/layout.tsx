import PageHeader from "@/components/panel/PageHeader";
import SettingsNav from "@/components/panel/settings/SettingsNav";

/** /panel/ayarlar/*: page title, the settings sub-navigation and the current settings screen. Admin only (checked per page and action). */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Sistem"
        title="Ayarlar"
        description="Mağazanın firma, kargo, ödeme ve iletişim ayarları. Her bölüm ayrı kaydedilir; değişiklik sitede hemen görünür."
      />
      <div className="grid gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10">
        <aside className="min-w-0">
          <SettingsNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
