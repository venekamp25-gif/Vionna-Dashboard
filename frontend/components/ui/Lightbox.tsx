"use client";

import { useEffect } from "react";

export function Lightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-8 cursor-pointer"
      onClick={onClose}
    >
      <button
        className="absolute top-6 right-8 text-white/70 hover:text-white text-3xl"
        aria-label="Close"
      >
        ×
      </button>
      <img
        src={url}
        alt="Full-size preview"
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
