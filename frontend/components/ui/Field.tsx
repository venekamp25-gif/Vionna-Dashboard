import { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";

const fieldBase =
  "w-full bg-bg-elev-2 border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-text placeholder:text-text-faint transition-all duration-150 hover:border-border-hover focus:outline-none focus:border-accent focus:bg-bg-elev focus:ring-3 focus:ring-[var(--accent-soft)]";

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <label className="block mb-1.5">
      <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-text-dim">
        {children}
      </span>
      {hint && (
        <span className="ml-2 text-[11px] font-normal text-text-faint normal-case tracking-normal">
          {hint}
        </span>
      )}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldBase} ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${fieldBase} resize-y leading-relaxed ${props.className ?? ""}`}
    />
  );
}

export function Field({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mb-4 ${className}`}>{children}</div>;
}
