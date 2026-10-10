import { cn } from "@/lib/utils";

type MobiCareLogoProps = {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  /**
   * On a dark background "Mobi" (dark green) disappears, so the logo sits on
   * a white pill, as in the patient app's header.
   */
  onDark?: boolean;
};

export function MobiCareLogo({
  className,
  markClassName,
  textClassName,
  onDark = false,
}: MobiCareLogoProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2",
        onDark && "gap-1.5 rounded-full bg-white px-2.5 py-1 shadow-sm",
        className,
      )}
      aria-label="MobiCare"
    >
      <img
        src={`${import.meta.env.BASE_URL}mobicare-pin.svg`}
        alt=""
        className={cn("h-9 w-auto shrink-0", markClassName)}
      />
      <span className={cn("font-bold text-xl leading-none", textClassName)}>
        <span className="text-[#0B3D2E]">Mobi</span>
        <span className="text-[#2E9E77]">Care</span>
      </span>
    </div>
  );
}