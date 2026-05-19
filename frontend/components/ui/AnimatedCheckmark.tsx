export function AnimatedCheckmark({ size = 56 }: { size?: number }) {
  return (
    <>
      <style>{`
        @keyframes ac-draw  { to { stroke-dashoffset: 0; } }
        @keyframes ac-pulse {
          0%   { box-shadow: 0 0 0 0 var(--accent-glow); }
          70%  { box-shadow: 0 0 0 20px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
      <div
        style={{
          width: size,
          height: size,
          background: "var(--accent)",
          animation: "ac-pulse 0.7s var(--ease-out, cubic-bezier(0.16,1,0.3,1)) 0.3s both",
        }}
        className="rounded-full flex items-center justify-center shrink-0"
      >
        <svg viewBox="0 0 26 26" width={size * 0.5} height={size * 0.5}>
          <path
            d="M4 13 L11 20 L22 7"
            fill="none"
            stroke="var(--on-accent)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: 30,
              strokeDashoffset: 30,
              animation: "ac-draw 0.5s cubic-bezier(0.16,1,0.3,1) 0.5s forwards",
            }}
          />
        </svg>
      </div>
    </>
  );
}
