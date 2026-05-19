import { Logo } from "./Logo";
import { StoreToggle } from "./StoreToggle";
import { ThemeToggle } from "./ThemeToggle";
import { BackendStatusBadge } from "./BackendStatusBadge";
import { LogoutButton } from "./LogoutButton";

export function Header() {
  return (
    <header className="bg-bg-elev border-b border-border h-15 flex items-center justify-between px-8 lg:px-12 xl:px-16 sticky top-0 z-50 backdrop-blur">
      <Logo />
      <div className="flex items-center gap-3">
        <BackendStatusBadge />
        <StoreToggle />
        <ThemeToggle />
        <LogoutButton />
      </div>
    </header>
  );
}
