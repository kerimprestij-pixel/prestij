import { LoaderCircle, type LucideIcon } from "lucide-react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./styles";

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (replaced by a spinner while pending). */
  icon?: LucideIcon;
  /** Shows a spinner, disables the button and sets aria-busy. */
  pending?: boolean;
  /** Label while pending, e.g. "Kaydediliyor…". */
  pendingLabel?: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
  children?: React.ReactNode;
};

/** Panel button. Defaults to type="button" so it never submits a form by accident. */
export default function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  pending = false,
  pendingLabel,
  className,
  disabled,
  type = "button",
  children,
  ref,
  ...rest
}: ButtonProps) {
  const iconClass = size === "sm" ? "size-3.5" : "size-4";
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {pending ? (
        <LoaderCircle aria-hidden className={`${iconClass} animate-spin motion-reduce:animate-none`} />
      ) : Icon ? (
        <Icon aria-hidden className={iconClass} />
      ) : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
