import { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  onRemove?: () => void;
  variant?: "default" | "color" | "keyword";
  color?: string;  // hex for color dot
  className?: string;
}

const variants = {
  default: "bg-bg-elev-2 text-text border border-border",
  color:   "bg-bg-elev-2 text-text border border-border pl-2",
  keyword: "bg-accent/10 text-accent border border-transparent",
};

export function Chip({ children, onRemove, variant = "default", color, className = "" }: ChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors duration-150 hover:border-border-hover ${variants[variant]} ${className}`}
    >
      {variant === "color" && color && (
        <span
          className="w-3 h-3 rounded-full border border-border"
          style={{ background: color }}
        />
      )}
      <span>{children}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 text-text-faint hover:text-danger transition-colors"
          aria-label="Remove"
        >
          ×
        </button>
      )}
    </span>
  );
}
