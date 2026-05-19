"use client";

import { useStore, StoreKey } from "@/lib/store";

function FlagDK() {
  return (
    <svg className="w-7 h-5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="28" height="20" fill="#C8102E" />
      <rect x="9" width="3" height="20" fill="#fff" />
      <rect y="8.5" width="28" height="3" fill="#fff" />
    </svg>
  );
}

function FlagFR() {
  return (
    <svg className="w-7 h-5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="9.33" height="20" fill="#002395" />
      <rect x="9.33" width="9.33" height="20" fill="#fff" />
      <rect x="18.66" width="9.34" height="20" fill="#ED2939" />
    </svg>
  );
}

export function StoreToggle() {
  const { store, setStore } = useStore();

  const Button = ({ value, children, title }: { value: StoreKey; children: React.ReactNode; title: string }) => {
    const active = store === value;
    return (
      <button
        onClick={() => setStore(value)}
        title={title}
        aria-label={title}
        className={[
          "flex items-center justify-center px-3.5 py-1.5 rounded-md transition-all duration-200",
          active
            ? "bg-accent shadow-sm [&_svg]:opacity-100"
            : "bg-transparent text-text-dim [&_svg]:opacity-55 hover:[&_svg]:opacity-100",
        ].join(" ")}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="inline-flex bg-bg-elev-2 rounded-lg p-[3px] gap-[2px]">
      <Button value="dk" title="Vionna DK"><FlagDK /></Button>
      <Button value="fr" title="Vionna FR"><FlagFR /></Button>
    </div>
  );
}
