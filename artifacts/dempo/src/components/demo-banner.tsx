import { useAppConfig } from "@/lib/app-config";

/**
 * Shown on every page of a public demo site so nobody mistakes it for the
 * real thing. A small fixed label (not a full-width strip) so it never shifts
 * the layout or covers buttons; it ignores clicks.
 */
export function DemoBanner() {
  const { publicDemo } = useAppConfig();
  if (!publicDemo) return null;
  return (
    <div
      role="note"
      className="pointer-events-none fixed bottom-3 left-1/2 -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0 z-50 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-md"
    >
      Demo site · all people and data are fictional
    </div>
  );
}
