import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The product lockup: college crest + "LMS" wordmark + institution line.
 * The thin laterite rule between them is the one place the brand's second
 * colour appears in the app chrome.
 */
export function BrandMark({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const crest = size === "lg" ? "w-12 h-12" : size === "sm" ? "w-7 h-7" : "w-8 h-8";
  const word = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  return (
    <span className={cn("inline-flex items-center gap-2.5 min-w-0", className)}>
      <img src={import.meta.env.BASE_URL + BRAND.logo} alt="" className={cn(crest, "shrink-0")} />
      <span className="flex items-center gap-2 min-w-0">
        <span
          className={cn("font-display font-bold leading-none text-primary", word)}
          style={{ fontStretch: "80%", letterSpacing: "0.02em" }}
        >
          {BRAND.name}
        </span>
        <span aria-hidden className="h-4 w-px bg-[hsl(var(--brand-laterite))] shrink-0" />
        <span className="text-[13px] leading-tight text-muted-foreground truncate">{BRAND.institution}</span>
      </span>
      <span className="sr-only">{`${BRAND.name} — ${BRAND.institutionFull}`}</span>
    </span>
  );
}
