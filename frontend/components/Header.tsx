"use client";

import { useState, useRef, useEffect } from "react";
import { Logo } from "./Logo";
import { StoreToggle } from "./StoreToggle";
import { ThemeToggle } from "./ThemeToggle";
import { BackendStatusBadge } from "./BackendStatusBadge";
import { LogoutButton } from "./LogoutButton";
import { SettingsModal } from "./SettingsModal";
import { HistoryModal } from "./HistoryModal";
import { ReportBugModal } from "./ReportBugModal";
import { KeywordBackfillModal } from "./KeywordBackfillModal";
import { KeywordResearchModal } from "./KeywordResearchModal";
import { WhatToListModal } from "./WhatToListModal";
import { CatalogMaintenanceModal } from "./CatalogMaintenanceModal";
import { useCatalogJobs } from "@/lib/catalogJobs";

export function Header() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [bugOpen, setBugOpen]           = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [whatToListOpen, setWhatToListOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const maintenanceRunning = useCatalogJobs().some((j) => j.status === "running");
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the Tools menu on outside click or Escape.
  useEffect(() => {
    if (!toolsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToolsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolsOpen]);

  // Each entry becomes a text row in the Tools dropdown. `divider` starts a new
  // group above the item; `running` shows a live indicator (catalogue jobs).
  const tools: {
    label: string;
    desc: string;
    action: () => void;
    running?: boolean;
    divider?: boolean;
  }[] = [
    { label: "What to list", desc: "Discover which product types to list now", action: () => setWhatToListOpen(true) },
    { label: "Keyword research", desc: "Best keywords for a type you already picked", action: () => setResearchOpen(true) },
    { label: "Keyword backfill", desc: "Regenerate copy for already-listed products", action: () => setBackfillOpen(true) },
    { label: "Catalogue maintenance", desc: "Bulk fixes (bold, channels, cutlines, duplicates)", action: () => setMaintenanceOpen(true), running: maintenanceRunning },
    { label: "Publish history", desc: "Products you recently published", action: () => setHistoryOpen(true) },
    { label: "Report a bug", desc: "Something not working? Let us know", action: () => setBugOpen(true), divider: true },
    { label: "Settings", desc: "API keys & preferences", action: () => setSettingsOpen(true) },
  ];

  return (
    <>
      <header className="bg-bg-elev border-b border-border h-15 flex items-center justify-between px-8 lg:px-12 xl:px-16 sticky top-0 z-50 backdrop-blur">
        <Logo />
        <div className="flex items-center gap-3">
          <BackendStatusBadge />
          <StoreToggle />

          {/* Tools dropdown — text labels instead of a row of emoji buttons */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setToolsOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
              className={[
                "relative inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-[13px] font-medium transition-colors",
                toolsOpen
                  ? "border-accent text-accent bg-[var(--accent-soft)]"
                  : "bg-bg-elev-2 border-border text-text-dim hover:text-accent hover:border-accent",
              ].join(" ")}
            >
              Tools
              <span className={`text-[9px] transition-transform ${toolsOpen ? "rotate-180" : ""}`}>▼</span>
              {maintenanceRunning && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent border border-bg-elev animate-pulse" />
              )}
            </button>

            {toolsOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-border bg-bg-elev shadow-xl py-1.5 z-[60]"
              >
                {tools.map((t) => (
                  <button
                    key={t.label}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setToolsOpen(false);
                      t.action();
                    }}
                    className={[
                      "w-full text-left px-3.5 py-2 hover:bg-bg-elev-2 transition-colors",
                      t.divider ? "border-t border-border mt-1.5 pt-2.5" : "",
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-1.5 text-[13px] text-text font-medium">
                      {t.label}
                      {t.running && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                          running
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-text-faint leading-snug mt-0.5">{t.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <ReportBugModal open={bugOpen} onClose={() => setBugOpen(false)} />
      <KeywordBackfillModal open={backfillOpen} onClose={() => setBackfillOpen(false)} />
      <KeywordResearchModal open={researchOpen} onClose={() => setResearchOpen(false)} />
      <WhatToListModal open={whatToListOpen} onClose={() => setWhatToListOpen(false)} />
      <CatalogMaintenanceModal open={maintenanceOpen} onClose={() => setMaintenanceOpen(false)} />
    </>
  );
}
