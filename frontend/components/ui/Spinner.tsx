export function Spinner({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <div
      className={`inline-block rounded-full border-[3px] border-border border-t-accent animate-spin ${className}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}
