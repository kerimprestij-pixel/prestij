"use client";
import { affixClass, controlClass, controlGroupClass, groupInputClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";

export type TextInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "prefix" | "size"> & {
  value: string | null | undefined;
  onChange: (value: string) => void;
  /** Text or icon inside the start edge, e.g. "https://" or "/urunler/". */
  prefix?: React.ReactNode;
  /** Text, icon or small button inside the end edge. */
  suffix?: React.ReactNode;
  invalid?: boolean;
  size?: "sm" | "md";
  ref?: React.Ref<HTMLInputElement>;
};

/** Single-line text input. `onChange` receives the string. */
export default function TextInput({
  value,
  onChange,
  prefix,
  suffix,
  invalid,
  size = "md",
  className,
  id,
  required,
  ref,
  "aria-describedby": describedBy,
  ...rest
}: TextInputProps) {
  const control = useFieldControl({ id, invalid, describedBy, required });
  const height = size === "sm" ? "h-9" : "h-10";
  const input = (
    <input
      ref={ref}
      type="text"
      {...rest}
      {...control}
      required={required}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className={prefix || suffix ? cn(groupInputClass, height) : cn(controlClass, height, "px-3", className)}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div className={cn(controlGroupClass, className)}>
      {prefix ? <span className={cn(affixClass, "border-e border-border")}>{prefix}</span> : null}
      {input}
      {suffix ? <span className={cn(affixClass, "border-s border-border")}>{suffix}</span> : null}
    </div>
  );
}
