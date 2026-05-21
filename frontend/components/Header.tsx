"use client";

import { useState } from "react";
import { Logo } from "./Logo";
import { StoreToggle } from "./StoreToggle";
import { ThemeToggle } from "./ThemeToggle";
import { BackendStatusBadge } from "./BackendStatusBadge";
import { LogoutButton } from "./LogoutButton";
import { SettingsModal } from "./SettingsModal";
import { HistoryModal } from "./HistoryModal";

export function Header() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen]   = useState(false);

  return (
    <>
      <header className="bg-bg-elev border-b border-border h-15 flex items-center justify-between px-8 lg:px-12 xl:px-16 sticky top-0 z-50 backdrop-blur">
        <Logo />
        <div className="flex items-center gap-3">
          <BackendStatusBadge />
          <StoreToggle />
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
    </>
  );
}
