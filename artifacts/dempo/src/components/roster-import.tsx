import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, RefreshCw, UserCheck, UserPlus } from "lucide-react";

type RowStatus = "create" | "update" | "existing_user" | "error";
type RowResult = {
  line: number;
  email: string | null;
  name: string | null;
  rollNo: string | null;
  role: string | null;
  cohorts: string[];
  status: RowStatus;
  message: string | null;
};
type ImportResult = {
  dryRun: boolean;
  summary: { rows: number; create: number; update: number; existingUser: number; errors: number };
  rows: RowResult[];
  emailsQueued?: number;
};

const TEMPLATE =
  "email,name,roll_no,role,cohort\n" +
  "asha.naik@college.edu.in,Asha Naik,21BBA001,student,BBA Sem 1 - A\n" +
  "ravi.kamat@college.edu.in,Ravi Kamat,21BBA002,student,BBA Sem 1 - A; Electives\n" +
  "prof.desai@college.edu.in,Prof. Desai,,teacher,\n";

const STATUS_LABEL: Record<RowStatus, string> = {
  create: "Will be invited",
  update: "Invite updated",
  existing_user: "Existing account",
  error: "Needs fixing",
};

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function cell(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

async function postImport(csv: string, dryRun: boolean, sendEmails: boolean): Promise<ImportResult> {
  const res = await fetch("/api/admin/roster/import", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv, dryRun, sendEmails }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "The import didn't go through. Please try again.");
  return body as ImportResult;
}

export function RosterImport() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [sendEmails, setSendEmails] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const reset = () => {
    setFileName(null);
    setCsv(null);
    setPreview(null);
    setDone(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setDone(null);
    setPreview(null);
    setError(null);
    if (file.size > 3_000_000) {
      setError("That file is larger than 3 MB. Split the roster into smaller files (up to 5,000 rows each).");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    setBusy("preview");
    try {
      setPreview(await postImport(text, true, false));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!csv) return;
    setBusy("import");
    setError(null);
    try {
      const result = await postImport(csv, false, sendEmails);
      setDone(result);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["admin-invites"] });
      toast({
        title: "Roster imported",
        description: `${result.summary.create} invited · ${result.summary.update} updated · ${result.summary.existingUser} existing accounts${result.summary.errors ? ` · ${result.summary.errors} rows skipped` : ""}`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const problemCsv = (rows: RowResult[]) =>
    "line,email,name,roll_no,role,cohort,problem\n" +
    rows
      .filter((r) => r.status === "error")
      .map((r) => [r.line, r.email, r.name, r.rollNo, r.role, r.cohorts.join("; "), r.message].map(cell).join(","))
      .join("\n");

  const result = preview ?? done;
  const importable = preview ? preview.summary.create + preview.summary.update + preview.summary.existingUser : 0;
  const rows = result ? [...result.rows].sort((a, b) => Number(b.status === "error") - Number(a.status === "error") || a.line - b.line) : [];
  const visible = showAll ? rows : rows.slice(0, 50);

  return (
    <Card className="shadow-sm mb-8">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Import a roster from CSV</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Invite a whole batch at once. Columns: <code>email</code> (required), <code>name</code>, <code>roll_no</code>,{" "}
              <code>role</code> (student or teacher), <code>cohort</code> (separate several with ";"). You'll see a preview before anything is saved.
              From Excel, use <em>File → Save As → CSV UTF-8</em>.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => download("roster-template.csv", TEMPLATE)} className="shrink-0">
            <Download className="w-4 h-4 mr-2" aria-hidden /> Template
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            id="roster-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button asChild variant={result ? "outline" : "default"}>
            <label htmlFor="roster-file" className="cursor-pointer">
              {busy === "preview" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : <FileUp className="w-4 h-4 mr-2" aria-hidden />}
              {fileName ? "Choose another file" : "Choose CSV file"}
            </label>
          </Button>
          {fileName && <span className="text-sm text-muted-foreground truncate max-w-[16rem]">{fileName}</span>}
          {result && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden /> Start over
            </Button>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm" role="alert">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {done && (
              <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm" role="status">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" aria-hidden />
                <span>
                  Import complete. {done.summary.create} new invitation{done.summary.create === 1 ? "" : "s"} created
                  {done.emailsQueued ? `, ${done.emailsQueued} invite emails on their way` : ""}.
                  {done.summary.errors > 0 && ` ${done.summary.errors} row${done.summary.errors === 1 ? " was" : "s were"} skipped — download them below, fix, and upload just those.`}
                </span>
              </div>
            )}

            <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <Stat icon={<UserPlus className="w-4 h-4" />} label="New invitations" value={result.summary.create} />
              <Stat icon={<RefreshCw className="w-4 h-4" />} label="Invites updated" value={result.summary.update} />
              <Stat icon={<UserCheck className="w-4 h-4" />} label="Existing accounts" value={result.summary.existingUser} />
              <Stat icon={<AlertTriangle className="w-4 h-4" />} label="Need fixing" value={result.summary.errors} tone={result.summary.errors ? "danger" : undefined} />
            </dl>

            {rows.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                <ul className="divide-y" aria-label="Rows in the file">
                  {visible.map((r) => (
                    <li key={`${r.line}-${r.email}`} className="p-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm">
                      <span className="text-xs text-muted-foreground w-14 shrink-0">Row {r.line}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium break-all">{r.email ?? "(no email)"}</span>
                        {(r.name || r.rollNo) && (
                          <span className="text-muted-foreground"> · {[r.name, r.rollNo].filter(Boolean).join(" · ")}</span>
                        )}
                        {r.message && <span className={`block text-xs mt-0.5 ${r.status === "error" ? "text-danger" : "text-muted-foreground"}`}>{r.message}</span>}
                      </span>
                      <span
                        className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border self-start sm:self-auto ${
                          r.status === "error" ? "border-danger/30 bg-danger/10 text-danger" : r.status === "create" ? "border-success/30 bg-success/10 text-success" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </li>
                  ))}
                </ul>
                {rows.length > visible.length && (
                  <button type="button" onClick={() => setShowAll(true)} className="w-full p-2 text-sm text-primary hover:bg-muted border-t">
                    Show all {rows.length.toLocaleString("en-IN")} rows
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              {result.summary.errors > 0 ? (
                <Button variant="outline" size="sm" onClick={() => download("roster-rows-to-fix.csv", problemCsv(result.rows))}>
                  <Download className="w-4 h-4 mr-2" aria-hidden /> Download rows to fix
                </Button>
              ) : (
                <span />
              )}
              {preview && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox id="roster-email" checked={sendEmails} onCheckedChange={(v) => setSendEmails(v === true)} />
                    <Label htmlFor="roster-email" className="text-sm font-normal">Email the invitations now</Label>
                  </div>
                  <Button onClick={commit} disabled={importable === 0 || busy === "import"}>
                    {busy === "import" && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />}
                    {importable === 0 ? "Nothing to import" : `Import ${importable.toLocaleString("en-IN")} row${importable === 1 ? "" : "s"}`}
                  </Button>
                </div>
              )}
            </div>
            {preview && preview.summary.errors > 0 && importable > 0 && (
              <p className="text-xs text-muted-foreground text-right">
                Rows that need fixing are skipped; everything else is imported together.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: "danger" }) {
  return (
    <div className={`rounded-md border p-3 ${tone === "danger" ? "border-danger/30 bg-danger/5" : "bg-muted/30"}`}>
      <dt className={`flex items-center gap-1.5 text-xs ${tone === "danger" ? "text-danger" : "text-muted-foreground"}`}>
        <span aria-hidden>{icon}</span>
        {label}
      </dt>
      <dd className="text-xl font-semibold mt-1 tabular-nums">{value.toLocaleString("en-IN")}</dd>
    </div>
  );
}
