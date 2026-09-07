/**
 * "Reset pilot data" — clears what the pilot collected so the platform can
 * start clean for real trading.
 *
 * The design is deliberately slow. A destructive action that cannot be undone
 * should not be one click away, and a warning that only says "are you sure?"
 * gives an operator nothing to be sure about. So the dialog fetches the real
 * counts first, lists what survives alongside what goes, and only enables the
 * button once the confirmation phrase has been typed out — the same phrase the
 * server independently requires.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HQ_ACCESS_KEY } from '@/lib/portalToken';
import { apiUrl } from '@/lib/apiUrl';

interface Preview {
  confirmationPhrase: string;
  totalRows: number;
  steps: Array<{ table: string; label: string; rows: number }>;
  preserved: string[];
}

interface Result {
  totalRows: number;
  images: { found: number; deleted: number };
}

const authHeaders = (): HeadersInit => ({
  Authorization: `Bearer ${localStorage.getItem(HQ_ACCESS_KEY)}`,
});

export default function ResetPilotData({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  const close = () => {
    setOpen(false);
    setPreview(null);
    setTyped('');
    setError('');
    setResult(null);
  };

  const start = async () => {
    setError('');
    setResult(null);
    setTyped('');
    setOpen(true);
    setBusy(true);
    try {
      const response = await fetch(apiUrl('/api/hq/insights/reset'), { headers: authHeaders() });
      if (!response.ok) {
        setError(
          response.status === 403
            ? 'Clearing pilot data needs both Data & Insights and settlement permissions.'
            : 'Unable to check what a reset would remove.',
        );
        return;
      }
      setPreview(await response.json() as Preview);
    } catch {
      setError('Unable to reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/api/hq/insights/reset'), {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: preview.confirmationPhrase }),
      });
      if (!response.ok) {
        setError('The reset did not run. Nothing was removed.');
        return;
      }
      setResult(await response.json() as Result);
      setPreview(null);
      // Refresh the charts behind the dialog, so the page is not still showing
      // numbers that no longer exist.
      onReset();
    } catch {
      setError('Unable to reach the server. Nothing was removed.');
    } finally {
      setBusy(false);
    }
  };

  const ready = preview !== null && typed.trim() === preview.confirmationPhrase;

  return (
    <section className="rounded-xl border border-destructive/40 bg-card p-4">
      <h2 className="font-semibold text-destructive">Reset pilot data</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Clears the searches, orders, prescriptions and commission records collected
        during the pilot, so the platform starts from zero for real trading.
        Pharmacies, patients, staff accounts, the catalogue and inventory are kept.
        This cannot be undone — export anything you want to keep first.
      </p>
      <Button className="mt-3" variant="destructive" onClick={() => void start()} data-testid="button-reset-pilot-data">
        Reset pilot data…
      </Button>

      <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{result ? 'Pilot data cleared' : 'Clear the pilot data?'}</DialogTitle>
            <DialogDescription>
              {result
                ? 'The platform is now starting from zero.'
                : 'This permanently removes the records listed below. It cannot be undone.'}
            </DialogDescription>
          </DialogHeader>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {busy && !preview && !result && <p className="text-sm text-muted-foreground">Checking…</p>}

          {result && (
            <div className="space-y-3 text-sm">
              <p><strong>{result.totalRows.toLocaleString()}</strong> records were removed.</p>
              {result.images.found > 0 && (
                <p className="text-muted-foreground">
                  {result.images.deleted.toLocaleString()} of {result.images.found.toLocaleString()} prescription
                  images were deleted from storage.
                  {result.images.deleted < result.images.found &&
                    ' The rest could not be reached and may need clearing by hand.'}
                </p>
              )}
              <p className="text-muted-foreground">The reset itself has been written to the audit log.</p>
              <Button onClick={close}>Done</Button>
            </div>
          )}

          {preview && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">
                  Will be deleted — {preview.totalRows.toLocaleString()} records
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {preview.steps.map((step) => (
                    <li key={step.table} className="flex justify-between gap-3 border-b pb-1 last:border-0">
                      <span className={step.rows === 0 ? 'text-muted-foreground' : undefined}>{step.label}</span>
                      <strong>{step.rows.toLocaleString()}</strong>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-sm font-medium">Will be kept</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {preview.preserved.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>

              <label className="block text-sm">
                Type <code className="rounded bg-muted px-1 font-mono">{preview.confirmationPhrase}</code> to confirm
                <Input
                  className="mt-1"
                  value={typed}
                  autoComplete="off"
                  onChange={(event) => setTyped(event.target.value)}
                  data-testid="input-reset-confirmation"
                />
              </label>

              <div className="flex gap-2">
                <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
                <Button
                  variant="destructive"
                  disabled={!ready || busy}
                  onClick={() => void confirm()}
                  data-testid="button-reset-confirm"
                >
                  {busy ? 'Clearing…' : 'Clear the pilot data'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
