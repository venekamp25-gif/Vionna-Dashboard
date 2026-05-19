import { Logo } from "./Logo";
import { StoreToggle } from "./StoreToggle";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="bg-bg-elev border-b border-border h-15 flex items-center justify-between px-8 sticky top-0 z-50 backdrop-blur">
      <Logo />
      <div className="flex items-center gap-2.5">
        <StoreToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
