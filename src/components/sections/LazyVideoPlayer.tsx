"use client";

// Day 6 (VIDEO-STORE): VideoPlayer behind React.lazy, so the player's code is its own chunk, fetched only
// on pages that show a video (the video section, a product video slide) and never part of the bundle every
// page with sections loads. The cover (children) is the Suspense fallback, so nothing changes on screen
// while the chunk loads; the server render resolves the player, so the static HTML is complete. If the
// chunk cannot load (e.g. a stale tab after a deploy) the cover simply stays.
import { lazy, Suspense } from "react";
import type { VideoPlayerProps } from "./VideoPlayer";

function CoverOnly({ children }: VideoPlayerProps) {
  return <>{children}</>;
}

const VideoPlayer = lazy(() => import("./VideoPlayer").catch(() => ({ default: CoverOnly })));

export default function LazyVideoPlayer(props: VideoPlayerProps) {
  return (
    <Suspense fallback={props.children}>
      <VideoPlayer {...props} />
    </Suspense>
  );
}
