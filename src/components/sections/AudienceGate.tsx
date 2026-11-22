"use client";
// Shows a page-builder section only to its audience, on static pages (rules in ./audience-gate-rules).
// The server and the first client render show the guest view, so guests never see a flash:
// - retail: rendered as is (no wrapper) and removed once the viewer is an approved business customer;
// - business: nothing until then, then the section fades in.
// The children are already rendered on the server; for a business section they travel in the page
// payload even while hidden (the panel tells editors not to put confidential content there).
import type { ReactNode } from "react";
import { useViewer } from "@/components/store/viewer/ViewerProvider";
import { showsForViewer } from "./audience-gate-rules";

export default function AudienceGate({ audience, children }: { audience: "retail" | "business"; children: ReactNode }) {
  const viewer = useViewer();
  if (!showsForViewer(audience, viewer)) return null;
  if (audience === "retail") return children;
  return (
    <div data-audience="business" className="motion-safe:animate-fade-in">
      {children}
    </div>
  );
}
