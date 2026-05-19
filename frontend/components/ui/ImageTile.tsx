"use client";

import { useState, ReactNode } from "react";

interface ImageTileProps {
  url: string;
  label?: string;
  selected?: boolean;
  pinned?: boolean;
  onToggle?: () => void;
  onZoom?: () => void;
  onPin?: () => void;
  onRegenerate?: () => void;
  className?: string;
  children?: ReactNode;  // for loading/error state overrides
}

export function ImageTile({
  url,
  label,
  selected,
  pinned,
  onToggle,
  onZoom,
  onPin,
  onRegenerate,
  className = "",
}: ImageTileProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      onClick={onToggle}
      className={[
        "relative aspect-[3/4] rounded-[10px] overflow-hidden cursor-pointer transition-all duration-200 border-2",
        selected
          ? "border-accent shadow-[0_0_0_2px_var(--accent-soft)]"
          : pinned
          ? "border-warning ring-2 ring-warning/40"
          : "border-border hover:border-border-hover hover:-translate-y-px hover:shadow-md",
        "bg-bg-elev-2 group",
        className,
      ].join(" ")}
    >
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-br from-bg-elev-2 to-bg-elev-3 animate-pulse" />
      )}
      <img
        src={url}
        alt={label ?? ""}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Label badge */}
      {label && (
        <div className="absolute bottom-1.5 left-1.5 px-2 py-1 rounded text-[11px] font-semibold text-white bg-black/65 backdrop-blur-sm">
          {label}{pinned ? " 📌" : ""}
        </div>
      )}

      {/* Selected checkmark */}
      <div
        className={[
          "absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-accent text-on-accent flex items-center justify-center text-sm font-bold transition-opacity duration-150",
          selected ? "opacity-100" : "opacity-0",
        ].join(" ")}
      >
        ✓
      </div>

      {/* Action buttons (visible on hover) */}
      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {onPin && (
          <button
            onClick={(e) => { e.stopPropagation(); onPin(); }}
            title={pinned ? "Unpin model" : "Pin as model reference"}
            className={[
              "w-6 h-6 rounded text-white text-xs flex items-center justify-center transition",
              pinned ? "bg-warning" : "bg-black/45 hover:bg-black/70",
            ].join(" ")}
          >
            📌
          </button>
        )}
        {onRegenerate && (
          <button
            onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
            title="Regenerate this image"
            className="w-6 h-6 rounded bg-black/45 hover:bg-black/70 text-white text-xs flex items-center justify-center transition"
          >
            ↻
          </button>
        )}
        {onZoom && (
          <button
            onClick={(e) => { e.stopPropagation(); onZoom(); }}
            title="Zoom"
            className="w-6 h-6 rounded bg-black/45 hover:bg-black/70 text-white text-xs flex items-center justify-center transition"
          >
            ⤢
          </button>
        )}
      </div>
    </div>
  );
}
