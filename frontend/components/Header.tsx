"use client";

import { useState } from "react";
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
  const maintenanceRunning = useCatalogJobs().some((j) => j.status === "running");

  return (
    <>
      <header className="bg-bg-elev border-b border-border h-15 flex items-center justify-between px-8 lg:px-12 xl:px-16 sticky top-0 z-50 backdrop-blur">
        <Logo />
        <div className="flex items-center gap-3">
          <BackendStatusBadge />
          <StoreToggle />
          <button
            type="button"
            onClick={() => setBugOpen(true)}
            title="Report a bug"
            aria-label="Report a bug"
            className="w-9 h-9 flex items-center justify-center rounded-md bg-bg-elev-2 text-text-dim hover:text-warning hover:border-warning border border-border transition-colors text-[14px]"
          >
            🐛
          </button>
          <button
            type="button"
            onClick={() => setBackfillOpen(true)}
            title="Keyword backfill — regenerate copy for already-listed products"
            aria-label="Open keyword backfill"
            className="w-9 h-9 flex items-center justify-center rounded-md bg-bg-elev-2 text-text-dim hover:text-accent hover:border-accent border border-border transition-colors text-[14px]"
          >
            🔑
          </button>
          <button
            type="button"
            onClick={() => setWhatToListOpen(true)}
            title="What to list — discover which product types to list now (per market)"
            aria-label="Open what to list"
            className="w-9 h-9 flex items-center justify-center rounded-md bg-bg-elev-2 text-text-dim hover:text-accent hover:border-accent border border-border transition-colors text-[14px]"
          >
            💡
          </button>
          <button
            type="button"
            onClick={() => setResearchOpen(true)}
            title="Keyword research — best keywords for a product type you already picked (with season)"
            aria-label="Open keyword research"
            className="w-9 h-9 flex items-center justify-center rounded-md bg-bg-elev-2 text-text-dim hover:text-accent hover:border-accent border border-border transition-colors text-[14px]"
          >
            📊
          </button>
          <button
            type="button"
            onClick={() => setMaintenanceOpen(true)}
            title={maintenanceRunning ? "Catalogue maintenance — a job is running" : "Catalogue maintenance — bulk fixes (bold, channels, cutlines, duplicates)"}
            aria-label="Open catalogue maintenance"
            className="relative w-9 h-9 flex items-center justify-center rounded-md bg-bg-elev-2 text-text-dim hover:text-accent hover:border-accent border border-border transition-colors text-[14px]"
          >
            🧹
            {maintenanceRunning && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent border border-bg-elev animate-pulse" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            title="Publish history"
            aria-label="Open publish history"
            className="w-9 h-9 flex items-center justify-center rounded-md bg-bg-elev-2 text-text-dim hover:text-accent hover:border-accent border border-border transition-colors text-[14px]"
          >
            ⌚
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Open settings"
            className="w-9 h-9 flex items-center justify-center rounded-md bg-bg-elev-2 text-text-dim hover:text-accent hover:border-accent border border-border transition-colors text-[14px]"
          >
            ⚙
          </button>
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
