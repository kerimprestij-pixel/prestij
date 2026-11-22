"use client";
// Success / failure buttons of the payment simulator. Both are disabled while the request runs
// (useFormStatus), so a double click cannot submit twice.

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

type Props = { approve: string; fail: string; processing: string };

export default function SimulatorButtons({ approve, fail, processing }: Props) {
  const { pending } = useFormStatus();
  const [clicked, setClicked] = useState<"success" | "failure" | null>(null);
  const base =
    "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <button
        type="submit"
        name="outcome"
        value="success"
        disabled={pending}
        onClick={() => setClicked("success")}
        className={cn(base, "bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500")}
      >
        {pending && clicked === "success" ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <CheckCircle2 aria-hidden className="size-4" />}
        {pending && clicked === "success" ? processing : approve}
      </button>
      <button
        type="submit"
        name="outcome"
        value="failure"
        disabled={pending}
        onClick={() => setClicked("failure")}
        className={cn(base, "border border-red-700/50 bg-transparent text-red-800 hover:bg-red-50 dark:border-red-400/50 dark:text-red-300 dark:hover:bg-red-950/40")}
      >
        {pending && clicked === "failure" ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <XCircle aria-hidden className="size-4" />}
        {pending && clicked === "failure" ? processing : fail}
      </button>
      <p aria-live="polite" className="sr-only">
        {pending ? processing : ""}
      </p>
    </div>
  );
}
