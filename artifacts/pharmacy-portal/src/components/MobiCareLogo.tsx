import { cn } from "@/lib/utils";

type MobiCareLogoProps = {
  className?: string;
  markClassName?: string;
  textClassName?: string;
};

export function MobiCareLogo({
  className,
  markClassName,
  textClassName,
}: MobiCareLogoProps) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)} aria-label="MobiCare">
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