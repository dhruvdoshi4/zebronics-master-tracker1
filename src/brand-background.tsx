import { ZEBRONICS_LOGO_SRC } from "./brand-logo";
import { cn } from "./utils";

export function OfficialBrandBackground({ className }: { className?: string }) {
  return (
    <div className={cn("brand-bg", className)} aria-hidden>
      <img src={ZEBRONICS_LOGO_SRC} alt="" className="brand-bg__logo" />
    </div>
  );
}
