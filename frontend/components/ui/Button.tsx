import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "publish" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-[10px] transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent shadow-sm hover:bg-accent-hover hover:-translate-y-px hover:shadow-[0_6px_24px_var(--accent-glow)]",
  secondary:
    "bg-bg-elev-2 text-text border border-border hover:bg-bg-elev hover:border-border-hover",
  ghost:
    "text-text-dim hover:bg-bg-elev-2 hover:text-text",
  publish:
    "bg-accent text-on-accent shadow-[0_4px_14px_var(--accent-glow)] hover:bg-accent-hover hover:shadow-[0_6px_20px_var(--accent-glow)]",
  danger:
    "bg-danger text-on-accent shadow-sm hover:bg-danger/90 hover:-translate-y-px",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-10 px-4 text-[13px]",
  lg: "h-12 px-6 text-[15px]",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
