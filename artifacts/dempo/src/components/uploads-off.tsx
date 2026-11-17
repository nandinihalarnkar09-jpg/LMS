import { Link2 } from "lucide-react";

/** Shown wherever a file picker would be, when no storage bucket is connected. */
export function UploadsOffNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-sm text-muted-foreground ${className}`} role="note">
      <Link2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
      <span>File uploads aren't switched on for this site yet. Share a link instead (Google Drive, OneDrive or YouTube).</span>
    </p>
  );
}
