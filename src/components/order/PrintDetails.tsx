"use client";
// Opens every <details data-print-open> while the page is printed (browser print or the page's own
// Yazdır button) and closes the ones it opened afterwards: a closed <details> prints only its summary.
import { useEffect } from "react";

export default function PrintDetails() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-print-open]:not([open])"));
      for (const d of opened) d.open = true;
    };
    const after = () => {
      for (const d of opened) d.open = false;
      opened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return null;
}
