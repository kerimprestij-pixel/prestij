"use client";
// The gift wheel's island in the storefront layout: the only wheel code in every page's first-load
// JavaScript, so it does almost nothing. It renders nothing on the server and on the first client
// render (no hydration risk, nothing in the static HTML, no layout shift), waits until the browser is
// idle and the viewer is known, drops approved business customers when the wheel is not for them, and
// then lazy-loads the launcher (teaser, reminder chip, triggers, which in turn lazy-loads the dialog).
import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import type { Locale } from "@/i18n/config";
import { whenIdle } from "./idle";
import type { WheelTeaserLabels } from "./labels";
import type { IslandTeaser, WheelLauncherProps } from "./WheelLauncher";

function Nothing() {
  return null;
}

/** If the chunk cannot be fetched (offline, or a new deployment replaced it), the wheel simply stays away. */
const WheelLauncher = lazy<ComponentType<WheelLauncherProps>>(() => import("./WheelLauncher").catch(() => ({ default: Nothing })));

export type GiftWheelIslandProps = { locale: Locale; teaser: IslandTeaser; labels: WheelTeaserLabels };

export default function GiftWheelIsland({ locale, teaser, labels }: GiftWheelIslandProps) {
  const viewer = useViewer();
  const [idle, setIdle] = useState(false);
  useEffect(() => whenIdle(() => setIdle(true)), []);

  if (!idle || !viewer.ready) return null;
  if (viewer.isBusiness && !teaser.showToBusiness) return null;
  return (
    <Suspense fallback={null}>
      <WheelLauncher locale={locale} teaser={teaser} labels={labels} signedIn={viewer.signedIn} />
    </Suspense>
  );
}
