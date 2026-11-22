"use client";
// Role picker as radio cards: each role with what it may do, so the admin picks with full information.
import { useId } from "react";
import { Check } from "lucide-react";
import { errorClass, labelClass } from "@/components/panel/ui/styles";
import { TEAM_ROLE_INFO, TEAM_ROLES, type StaffRole } from "@/lib/panel/team/rules";
import { cn } from "@/lib/utils";

export default function RoleChoice({
  value,
  onChange,
  error,
  current,
}: {
  value: StaffRole;
  onChange: (role: StaffRole) => void;
  error?: string;
  /** The saved role (marked "Şu anki"). */
  current?: StaffRole;
}) {
  const name = useId();
  const errorId = useId();
  return (
    <fieldset aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined} data-field="role">
      <legend className={labelClass}>
        Rol <span aria-hidden className="text-[#B3261E] dark:text-[#F28B82]">*</span>
      </legend>
      <div className="mt-2 grid gap-2">
        {TEAM_ROLES.map((role) => {
          const checked = value === role;
          return (
            <label
              key={role}
              className={cn(
                "relative flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
                checked ? "border-brand bg-brand/5" : "border-border hover:border-gold/50",
              )}
            >
              <input
                type="radio"
                name={name}
                value={role}
                checked={checked}
                onChange={() => onChange(role)}
                aria-labelledby={`${name}-${role}-label`}
                aria-describedby={`${name}-${role}-summary`}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                  checked ? "border-brand bg-brand text-brand-contrast" : "border-border bg-surface",
                )}
              >
                {checked ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0">
                <span id={`${name}-${role}-label`} className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                  {TEAM_ROLE_INFO[role].label}
                  {current === role ? <span className="text-xs font-normal text-text-muted">(şu anki)</span> : null}
                </span>
                <span id={`${name}-${role}-summary`} className="mt-0.5 block text-xs leading-relaxed text-text-muted">
                  {TEAM_ROLE_INFO[role].summary}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} className={cn(errorClass, "mt-1.5")}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
