import { useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Bulk upload from a spreadsheet: download the template (or an export),
 * upload it, review what each row will do, decide on duplicates, save.
 * Nothing is saved until the person presses Save.
 *
 * The same component is used in the pharmacy portal and in HQ; keep the two
 * copies in step.
 */

export interface SpreadsheetFile {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export interface PreviewRow {
  rowNumber: number;
  status: string;
  message: string | null;
  warnings: string[];
  changes: Array<{ field: string; from: string; to: string }>;
  summary: string;
}

export interface Preview {
  fileName: string;
  summary: Record<string, number>;
  rows: PreviewRow[];
}

export interface ApplyBody {
  fileName: string;
  contentBase64: string;
  decisions: Record<string, "override" | "skip">;
  duplicateDefault: "override" | "skip" | null;
}

interface Props<Result extends { errorReport?: SpreadsheetFile | null }> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  getTemplate: () => Promise<SpreadsheetFile>;
  getExport?: () => Promise<SpreadsheetFile>;
  exportLabel?: string;
  preview: (upload: { fileName: string; contentBase64: string }) => Promise<Preview>;
  apply: (body: ApplyBody) => Promise<Result>;
  /** One line per outcome, e.g. "12 added". */
  describeResult: (result: Result) => string[];
  onSaved?: () => void;
}

const MAX_BYTES = 5 * 1024 * 1024;

const STATUS: Record<string, { label: string; plural: string; className: string }> = {
  new: { label: "New", plural: "new", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  change: { label: "Update", plural: "updates", className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  duplicate: { label: "Duplicate", plural: "duplicates", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" },
  unchanged: { label: "No change", plural: "unchanged", className: "bg-muted text-muted-foreground" },
  remove: { label: "Remove", plural: "to remove", className: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200" },
  review: { label: "HQ review", plural: "for HQ review", className: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  error: { label: "Problem", plural: "problems", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

export function downloadSpreadsheet(file: SpreadsheetFile): void {
  const bytes = Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function errorText(error: unknown): string {
  const data = (error as { data?: { error?: string } })?.data;
  if (data?.error) return data.error;
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

type Filter = "all" | "attention";

export function BulkUploadDialog<Result extends { errorReport?: SpreadsheetFile | null }>(props: Props<Result>) {
  const { open, onOpenChange, title, description } = props;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"template" | "export" | "preview" | "apply" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ fileName: string; contentBase64: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "override" | "skip">>({});
  const [filter, setFilter] = useState<Filter>("attention");
  const [result, setResult] = useState<Result | null>(null);

  const reset = () => {
    setBusy(null);
    setProblem(null);
    setUpload(null);
    setPreview(null);
    setDecisions({});
    setFilter("attention");
    setResult(null);
    if (input.current) input.current.value = "";
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const download = async (kind: "template" | "export") => {
    setBusy(kind);
    setProblem(null);
    try {
      downloadSpreadsheet(await (kind === "template" ? props.getTemplate() : props.getExport!()));
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (file.size > MAX_BYTES) {
      setProblem("That file is larger than 5 MB. Split it into smaller files.");
      return;
    }
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setProblem("Upload an Excel (.xlsx) or CSV file. Older .xls files: open in Excel and save as .xlsx.");
      return;
    }
    setBusy("preview");
    try {
      const next = { fileName: file.name, contentBase64: await readFile(file) };
      const checked = await props.preview(next);
      setUpload(next);
      setPreview(checked);
      setDecisions({});
      const needsAttention = checked.rows.some((row) => ["error", "duplicate"].includes(row.status) || row.warnings.length > 0);
      setFilter(needsAttention ? "attention" : "all");
    } catch (error) {
      setProblem(errorText(error));
      if (input.current) input.current.value = "";
    } finally {
      setBusy(null);
    }
  };

  const duplicates = preview?.rows.filter((row) => row.status === "duplicate") ?? [];
  const undecided = duplicates.filter((row) => !decisions[String(row.rowNumber)]).length;
  const toSave = (preview?.rows ?? []).filter(
    (row) =>
      ["new", "change", "remove", "review"].includes(row.status) ||
      (row.status === "duplicate" && decisions[String(row.rowNumber)] === "override"),
  ).length;

  const save = async () => {
    if (!upload) return;
    setBusy("apply");
    setProblem(null);
    try {
      const saved = await props.apply({ ...upload, decisions, duplicateDefault: null });
      setResult(saved);
      props.onSaved?.();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => {
    const rows = preview?.rows ?? [];
    return filter === "all"
      ? rows
      : rows.filter((row) => ["error", "duplicate"].includes(row.status) || row.warnings.length > 0);
  }, [preview, filter]);

  const setAll = (decision: "override" | "skip") =>
    setDecisions(Object.fromEntries(duplicates.map((row) => [String(row.rowNumber), decision])));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {problem && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" data-testid="bulk-problem">
            {problem}
          </div>
        )}

        {result ? (
          <div className="space-y-4" data-testid="bulk-result">
            <ul className="space-y-1 text-sm">
              {props.describeResult(result).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {result.errorReport && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
                <p>Rows with problems were not saved. Download them, correct them, and upload that file.</p>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadSpreadsheet(result.errorReport!)} data-testid="button-download-error-report">
                  <Download className="h-4 w-4" /> Download rows to fix
                </Button>
              </div>
            )}
          </div>
        ) : preview ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="bulk-summary">
              <span className="font-medium text-sm mr-1 truncate max-w-[16rem]" title={preview.fileName}>
                <FileSpreadsheet className="inline h-4 w-4 mr-1 -mt-0.5" />
                {preview.fileName}
              </span>
              {Object.entries(STATUS).map(([status, style]) =>
                preview.summary[status] ? (
                  <span key={status} className={`rounded-full px-2 py-0.5 font-medium ${style.className}`}>
                    {preview.summary[status]} {preview.summary[status] === 1 ? style.label.toLowerCase() : style.plural}
                  </span>
                ) : null,
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-md border p-0.5 text-sm">
                {(["attention", "all"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={`rounded px-3 py-1 ${filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  >
                    {value === "all" ? `All rows (${preview.rows.length})` : "Needs attention"}
                  </button>
                ))}
              </div>
              {duplicates.length > 1 && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">All duplicates:</span>
                  <Button size="sm" variant="outline" onClick={() => setAll("override")} data-testid="button-override-all">Override</Button>
                  <Button size="sm" variant="outline" onClick={() => setAll("skip")} data-testid="button-skip-all">Skip</Button>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border divide-y" data-testid="bulk-rows">
              {shown.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">Nothing needs attention. Every row can be saved.</p>
              )}
              {shown.map((row) => {
                const style = STATUS[row.status] ?? STATUS.unchanged!;
                const decision = decisions[String(row.rowNumber)];
                return (
                  <div key={row.rowNumber} className="p-3 text-sm space-y-1.5" data-testid={`bulk-row-${row.rowNumber}`}>
                    <div className="flex items-start gap-2">
                      <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums pt-0.5">Row {row.rowNumber}</span>
                      <span className="flex-1 min-w-0 font-medium break-words">{row.summary}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>{style.label}</span>
                    </div>
                    <div className="pl-16 space-y-1">
                      {row.message && (
                        <p className={row.status === "error" ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}>{row.message}</p>
                      )}
                      {row.warnings.map((warning) => (
                        <p key={warning} className="text-amber-800 dark:text-amber-300">⚠ {warning}</p>
                      ))}
                      {row.changes.length > 0 && (
                        <ul className="text-xs text-muted-foreground space-y-0.5">
                          {row.changes.map((change) => (
                            <li key={change.field}>
                              <span className="font-medium text-foreground">{change.field}:</span> {change.from} → {change.to}
                            </li>
                          ))}
                        </ul>
                      )}
                      {row.status === "duplicate" && (
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant={decision === "override" ? "default" : "outline"} onClick={() => setDecisions({ ...decisions, [row.rowNumber]: "override" })} data-testid={`button-override-${row.rowNumber}`}>
                            Override
                          </Button>
                          <Button size="sm" variant={decision === "skip" ? "default" : "outline"} onClick={() => setDecisions({ ...decisions, [row.rowNumber]: "skip" })} data-testid={`button-skip-${row.rowNumber}`}>
                            Skip
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {(preview.summary.error ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Rows with problems are not saved. After saving you can download them to fix.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <ol className="list-decimal pl-5 text-sm space-y-1 text-muted-foreground">
              <li>Download the template{props.getExport ? ", or export what is there now to edit it" : ""}.</li>
              <li>Fill it in with Excel, Google Sheets or any spreadsheet app. Save as .xlsx or .csv.</li>
              <li>Upload it. You will see what each row does before anything is saved.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" disabled={busy !== null} onClick={() => download("template")} data-testid="button-download-template">
                {busy === "template" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download template
              </Button>
              {props.getExport && (
                <Button variant="outline" className="gap-2" disabled={busy !== null} onClick={() => download("export")} data-testid="button-export">
                  {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {props.exportLabel ?? "Export current"}
                </Button>
              )}
            </div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring">
              {busy === "preview" ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
              <span className="text-sm font-medium">{busy === "preview" ? "Checking the file…" : "Choose a file to upload"}</span>
              <span className="text-xs text-muted-foreground">Excel (.xlsx) or CSV, up to 5 MB and 5,000 rows</span>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="sr-only"
                disabled={busy !== null}
                onChange={(event) => choose(event.target.files?.[0])}
                data-testid="input-bulk-file"
              />
            </label>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {result ? (
            <Button onClick={() => close(false)} data-testid="button-bulk-close">Done</Button>
          ) : preview ? (
            <>
              <Button variant="outline" onClick={reset} disabled={busy !== null}>Choose another file</Button>
              <Button onClick={save} disabled={busy !== null || undecided > 0 || toSave === 0} data-testid="button-bulk-save">
                {busy === "apply" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {undecided > 0
                  ? `Decide ${undecided} duplicate${undecided === 1 ? "" : "s"} first`
                  : toSave === 0
                    ? "Nothing to save"
                    : `Save ${toSave} row${toSave === 1 ? "" : "s"}`}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
