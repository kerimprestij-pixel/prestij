// Page header shared by the three Hediye Çarkı tabs. Server-safe.
import PageHeader from "@/components/panel/PageHeader";

export default function WheelPageHeader({ actions }: { actions?: React.ReactNode }) {
  return (
    <PageHeader
      eyebrow="Pazarlama"
      title="Hediye Çarkı"
      description="Ziyaretçi çarkı bir kez çevirir, mutlaka bir hediye kazanır ve hediyeyi almak için ücretsiz üye olur. Hediye, hesaba tanımlı tek kullanımlık bir indirim kodudur ve sepette kendiliğinden uygulanır."
      actions={actions}
    />
  );
}
