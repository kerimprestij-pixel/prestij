import Badge from "@/components/panel/ui/Badge";
import type { Tone } from "@/components/panel/labels";
import { formatIstanbul } from "@/lib/panel/format";
import type { PanelThemeStatus } from "@/lib/panel/theme/queries";

/** Label, tone and explanation of a theme's status (Turkish, for the list and the editor). */
export function themeStatusInfo(status: PanelThemeStatus): { label: string; tone: Tone; detail: string } {
  switch (status.kind) {
    case "live":
      return {
        label: "Şu an aktif",
        tone: "success",
        detail:
          status.reason === "campaign"
            ? "Bağlı bir kampanya sürdüğü için sitede bu tema gösteriliyor."
            : status.reason === "scheduled"
              ? "Planlanan zaman aralığında; sitede bu tema gösteriliyor."
              : "Planlı ya da kampanyaya bağlı bir tema yokken sitede bu tema gösterilir.",
      };
    case "waiting":
      return { label: "Beklemede", tone: "warning", detail: "Zaman aralığında, ancak önceliği daha yüksek bir tema gösteriliyor." };
    case "upcoming":
      return { label: "Planlandı", tone: "info", detail: `${formatIstanbul(status.startsAt)} tarihinde başlayacak.` };
    case "standby":
      return { label: "Yedekte", tone: "neutral", detail: "Planlı ya da kampanya teması bitince site bu temaya döner." };
    case "ended":
      return { label: "Bitti", tone: "neutral", detail: "Zaman aralığı geçti; tekrar kullanmak için yeni tarihler girin." };
    default:
      return { label: "Kullanılmıyor", tone: "neutral", detail: "Planlanmadı ve bir kampanyaya bağlı değil." };
  }
}

export default function ThemeStatusBadge({ status }: { status: PanelThemeStatus }) {
  const info = themeStatusInfo(status);
  return (
    <Badge tone={info.tone} title={info.detail}>
      {info.label}
    </Badge>
  );
}
