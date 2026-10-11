import { cn } from "@/lib/utils";

type MobiCareLogoProps = {
  className?: string;
  /** "lg" for the sign-in page; "md" for the sidebar and the phone header. */
  size?: "md" | "lg";
};

/**
 * The MobiCare logo exactly as the patient app shows it: the pin and
 * "MobiCare" (Outfit, bold) on a white pill, so it reads on the dark sidebar
 * and on light pages alike.
 */
export function MobiCareLogo({ className, size = "md" }: MobiCareLogoProps) {
  const large = size === "lg";
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full bg-white shadow-sm ring-1 ring-black/5",
        large ? "gap-2 px-4 py-2" : "gap-1.5 px-2.5 py-1",
        className,
      )}
      aria-label="MobiCare"
    >
      <img
        src={`${import.meta.env.BASE_URL}mobicare-pin.png`}
        alt=""
        className={cn("w-auto shrink-0", large ? "h-10" : "h-7")}
      />
      <span
        className={cn("font-bold leading-none", large ? "text-3xl" : "text-lg")}
        style={{ fontFamily: "'Outfit', sans-serif" }}
      >
        <span className="text-[#0B3D2E]">Mobi</span>
        <span className="text-[#2E9E77]">Care</span>
      </span>
    </div>
  );
}
