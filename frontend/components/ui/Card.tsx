import { ReactNode } from "react";

export function Card({
  children,
  title,
  className = "",
}: {
  children: ReactNode;
  title?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-bg-elev border border-border rounded-2xl p-7 shadow-sm hover:border-border-hover transition-colors duration-200 ${className}`}
    >
      {title && (
        <h2 className="text-[15px] font-semibold mb-4 tracking-tight text-text">{title}</h2>
      )}
      {children}
    </section>
  );
}
