import { useEffect, useMemo, useState } from 'react';
import {
  useListDeliveryZones,
  useCreateDeliveryZone,
  useUpdateDeliveryZone,
  useSetDeliveryZoneStatus,
  useDeleteDeliveryZone,
  usePreviewDeliveryZone,
  getListDeliveryZonesQueryKey,
  type DeliveryZone,
  type DeliveryZonePreview,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, MapPinned, Pencil, Plus, Power, Trash2, Undo2, X } from 'lucide-react';
import HqLayout from './HqLayout';
import { DeliveryPricingPanel } from './DeliveryPricingPanel';
import { EmptyState } from './shared';
import { useHqAuth } from '@/hq/auth';
import { ZoneMap } from '@/components/map/ZoneMap';
import { zoneColours, type Position, type ZoneOutline } from '@/components/map/mapConfig';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

type Editing =
  | { kind: 'new'; name: string; description: string; fee: string }
  | { kind: 'edit'; zone: DeliveryZone; name: string; description: string };

// Zones no longer carry a fee (distance prices delivery); new ones are saved with 0.
const leonesToMinor = (text: string) => Math.round(Number(text) * 100);

function apiError(err: unknown): string {
  const data = (err as { data?: { error?: unknown } | null })?.data;
  if (typeof data?.error === 'string') return data.error;
  return err instanceof Error ? err.message : 'Please try again.';
}

function firstRing(boundary: ZoneOutline): Position[] {
  const ring = boundary.type === 'Polygon' ? boundary.coordinates[0] : boundary.coordinates[0]?.[0];
  const corners = [...(ring ?? [])];
  const first = corners[0];
  const last = corners[corners.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) corners.pop();
  return corners;
}

export default function HqDeliveryZones() {
  const { user } = useHqAuth();
  const canManage = user?.canManageSettlements === true;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListDeliveryZones();
  const zones = data?.zones ?? [];
  const pharmacies = data?.pharmacies ?? [];

  const [editing, setEditing] = useState<Editing | null>(null);
  const [corners, setCorners] = useState<Position[] | null>(null);
  const [history, setHistory] = useState<Position[][]>([]);
  const [preview, setPreview] = useState<DeliveryZonePreview | null>(null);
  const [statusZone, setStatusZone] = useState<DeliveryZone | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListDeliveryZonesQueryKey() });
  const onError = (err: unknown) =>
    toast({ title: 'Not saved', description: apiError(err), variant: 'destructive' });

  const create = useCreateDeliveryZone();
  const update = useUpdateDeliveryZone();
  const setStatus = useSetDeliveryZoneStatus();
  const deleteZone = useDeleteDeliveryZone();
  const [deletingZone, setDeletingZone] = useState<DeliveryZone | null>(null);
  const previewZone = usePreviewDeliveryZone();

  const mapZones = useMemo(
    () =>
      zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        boundary: zone.boundary as unknown as ZoneOutline,
        isActive: zone.isActive,
        feeLabel: `${zone.areaSquareKm} km²`,
      })),
    [zones],
  );
  const pharmaciesByZone = useMemo(() => {
    const counts = new Map<string, string[]>();
    for (const pharmacy of pharmacies) {
      if (!pharmacy.zoneId) continue;
      counts.set(pharmacy.zoneId, [...(counts.get(pharmacy.zoneId) ?? []), pharmacy.name]);
    }
    return counts;
  }, [pharmacies]);
  // Delivery needs the pharmacy's map position (the distance is measured from it).
  const unplaced = pharmacies.filter((p) => p.isActive && p.latitude == null);
  const colours = useMemo(() => zoneColours(mapZones), [mapZones]);

  // Check the outline as it is drawn: valid, what it overlaps, who it moves.
  const cornerKey = JSON.stringify(corners);
  useEffect(() => {
    if (!editing || !corners || corners.length < 3) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      previewZone
        .mutateAsync({
          data: {
            ...(editing.kind === 'edit' ? { zoneId: editing.zone.id } : {}),
            ...(editing.name.trim() ? { name: editing.name.trim() } : {}),
            boundary: { type: 'Polygon', coordinates: [[...corners, corners[0]!]] },
          },
        })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(timer);
    // previewZone is a new object each render; the corners are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cornerKey, editing?.kind, editing?.name]);

  function changeCorners(next: Position[]) {
    if (corners) setHistory((past) => [...past.slice(-49), corners]);
    setCorners(next);
  }

  function undo() {
    setHistory((past) => {
      const previous = past[past.length - 1];
      if (previous) setCorners(previous);
      return past.slice(0, -1);
    });
  }

  function startNew() {
    setEditing({ kind: 'new', name: '', description: '', fee: '0' });
    setCorners([]);
    setHistory([]);
    setSelectedId(null);
  }

  function startEdit(zone: DeliveryZone) {
    setEditing({ kind: 'edit', zone, name: zone.name, description: zone.description });
    setCorners(firstRing(zone.boundary as unknown as ZoneOutline));
    setHistory([]);
    setSelectedId(zone.id);
  }

  function stopEditing() {
    setEditing(null);
    setCorners(null);
    setHistory([]);
    setPreview(null);
  }

  async function save() {
    if (!editing || !corners) return;
    const boundary = { type: 'Polygon' as const, coordinates: [[...corners, corners[0]!]] };
    try {
      if (editing.kind === 'new') {
        await create.mutateAsync({
          data: {
            name: editing.name.trim(),
            description: editing.description.trim(),
            boundary,
            feeMinor: leonesToMinor(editing.fee),
          },
        });
        toast({ title: 'Zone created', description: `New orders in this area are labelled ${editing.name.trim()}.` });
      } else {
        const outlineChanged =
          JSON.stringify(corners) !== JSON.stringify(firstRing(editing.zone.boundary as unknown as ZoneOutline));
        await update.mutateAsync({
          id: editing.zone.id,
          data: {
            name: editing.name.trim(),
            description: editing.description.trim(),
            ...(outlineChanged ? { boundary } : {}),
          },
        });
        toast({ title: 'Zone saved', description: 'New orders are labelled with the new outline from now.' });
      }
      stopEditing();
      await refresh();
    } catch (err) {
      onError(err);
    }
  }

  async function toggleStatus() {
    if (!statusZone) return;
    try {
      await setStatus.mutateAsync({ id: statusZone.id, data: { isActive: !statusZone.isActive } });
      toast({
        title: statusZone.isActive ? 'Zone switched off' : 'Zone switched on',
        description: statusZone.isActive
          ? `New orders are no longer labelled ${statusZone.name}.`
          : `New orders in this area are labelled ${statusZone.name} again.`,
      });
      setStatusZone(null);
      await refresh();
    } catch (err) {
      setStatusZone(null);
      onError(err);
    }
  }

  async function confirmDelete() {
    if (!deletingZone) return;
    const zone = deletingZone;
    try {
      await deleteZone.mutateAsync({ id: zone.id });
      toast({ title: 'Zone deleted', description: `${zone.name} is gone. Past orders keep its name.` });
      if (editing?.kind === 'edit' && editing.zone.id === zone.id) stopEditing();
      setDeletingZone(null);
      await refresh();
    } catch (err) {
      setDeletingZone(null);
      onError(err);
    }
  }

  const drawingReady =
    !!editing &&
    !!corners &&
    corners.length >= 3 &&
    preview?.valid === true &&
    editing.name.trim().length >= 2;
  const saving = create.isPending || update.isPending;

  return (
    <HqLayout title="Delivery Zones">
      <div className="space-y-4">
        <DeliveryPricingPanel canManage={canManage} />

        <div className="flex flex-wrap items-start justify-between gap-3 pt-2">
          <div className="max-w-2xl">
            <h2 className="font-display font-semibold text-lg text-dark-green">Named areas (optional)</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Zones no longer set the delivery fee or decide where MobiCare delivers: distance does. They only name the
              area on orders, in Dispatch and in reports. Without a zone, the district name is used.
            </p>
          </div>
          {canManage && !editing && (
            <Button onClick={startNew} variant="outline" className="rounded-full" data-testid="button-new-zone">
              <Plus className="w-4 h-4" /> New zone
            </Button>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-2">
            <ZoneMap
              zones={mapZones}
              pharmacies={pharmacies}
              draft={corners}
              editingZoneId={editing?.kind === 'edit' ? editing.zone.id : null}
              onDraftChange={changeCorners}
              onSelectZone={setSelectedId}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0b3b2e] border-2 border-white shadow" /> Pharmacy in a zone
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#d97706] border-2 border-white shadow" /> Pharmacy outside every zone (still delivers)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-[#8a948f]" /> Switched off
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {editing ? (
              <div className="rounded-xl border bg-card p-4 space-y-4" data-testid="panel-zone-editor">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-semibold text-dark-green">
                    {editing.kind === 'new' ? 'New zone' : `Edit ${editing.zone.name}`}
                  </h2>
                  <button onClick={stopEditing} className="text-muted-foreground hover:text-foreground" aria-label="Cancel">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zone-name">Name</Label>
                  <Input
                    id="zone-name"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="e.g. Lumley & Aberdeen"
                    data-testid="input-zone-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zone-description">Notes (optional)</Label>
                  <Textarea
                    id="zone-description"
                    rows={2}
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder="Roads or landmarks along the border"
                  />
                </div>
                <div className="rounded-lg bg-secondary/40 p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <MapPinned className="w-3.5 h-3.5" /> Drawing the outline
                  </p>
                  <p>Tap the map to add corners. Drag a corner to move it, tap it to remove it, or tap a hollow dot to add one between two corners.</p>
                  <p>Corners snap onto neighbouring zones, so shared borders line up.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={undo} disabled={history.length === 0}>
                    <Undo2 className="w-4 h-4" /> Undo
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => changeCorners([])} disabled={!corners?.length}>
                    Clear
                  </Button>
                  <span className="text-xs text-muted-foreground ml-auto">{corners?.length ?? 0} corners</span>
                </div>

                <PreviewResult corners={corners?.length ?? 0} preview={preview} />

                <div className="flex gap-2 pt-1">
                  <Button className="flex-1 rounded-full" onClick={save} disabled={!drawingReady || saving} data-testid="button-save-zone">
                    {saving ? 'Saving…' : editing.kind === 'new' ? 'Create zone' : 'Save changes'}
                  </Button>
                  <Button variant="outline" className="rounded-full" onClick={stopEditing}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : isLoading ? (
              <EmptyState>Loading zones…</EmptyState>
            ) : zones.length === 0 ? (
              <EmptyState>
                No named areas yet. Orders are labelled with their district.
              </EmptyState>
            ) : (
              <>
                {zones.map((zone) => {
                  const inZone = pharmaciesByZone.get(zone.id) ?? [];
                  return (
                    <div
                      key={zone.id}
                      className={`rounded-xl border bg-card p-4 space-y-2 transition-shadow ${
                        selectedId === zone.id ? 'ring-2 ring-primary/40' : ''
                      }`}
                      data-testid={`zone-${zone.id}`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-1 w-3 h-3 rounded-sm shrink-0"
                          style={{ background: zone.isActive ? colours.get(zone.id) : '#8a948f' }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium leading-tight">{zone.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {zone.areaSquareKm} km² · {inZone.length} {inZone.length === 1 ? 'pharmacy' : 'pharmacies'}
                          </div>
                        </div>
                        {!zone.isActive && <Badge variant="secondary">Switched off</Badge>}
                      </div>
                      {canManage && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <Button size="sm" variant="outline" onClick={() => startEdit(zone)}>
                            <Pencil className="w-3.5 h-3.5" /> Outline
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setStatusZone(zone)}>
                            <Power className="w-3.5 h-3.5" /> {zone.isActive ? 'Switch off' : 'Switch on'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeletingZone(zone)}
                            data-testid={`button-delete-zone-${zone.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {unplaced.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1.5">
                    <div className="font-medium flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> Collection only
                    </div>
                    <p className="text-xs">These pharmacies have no map position, so the delivery distance cannot be measured. Add it in Pharmacies:</p>
                    <ul className="text-xs list-disc pl-4">
                      {unplaced.map((p) => <li key={p.id}>{p.name}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={!!statusZone} onOpenChange={(open) => !open && setStatusZone(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusZone?.isActive ? `Switch off ${statusZone?.name}?` : `Switch on ${statusZone?.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusZone?.isActive ? (
                <>New orders here are labelled with the district instead. Delivery is not affected: distance decides it.</>
              ) : (
                <>New orders in this area are labelled with its name again.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep as it is</AlertDialogCancel>
            <AlertDialogAction onClick={toggleStatus}>
              {statusZone?.isActive ? 'Switch off' : 'Switch on'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deletingZone} onOpenChange={(open) => !open && setDeletingZone(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingZone?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The area name disappears from this page and from new orders, which use the district instead. Past
              orders keep its name. Delivery is not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the zone</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-zone"
            >
              Delete zone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </HqLayout>
  );
}

function PreviewResult({ corners, preview }: { corners: number; preview: DeliveryZonePreview | null }) {
  if (corners < 3) {
    return <p className="text-xs text-muted-foreground">Add at least three corners to see the zone.</p>;
  }
  if (!preview) return <p className="text-xs text-muted-foreground">Checking…</p>;
  return (
    <div className="space-y-2 text-sm" data-testid="zone-preview">
      {preview.valid ? (
        <p className="flex items-center gap-1.5 text-primary">
          <CheckCircle2 className="w-4 h-4" /> Outline is valid
          {preview.areaSquareKm != null && <span className="text-muted-foreground"> · {preview.areaSquareKm} km²</span>}
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-destructive">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {preview.error}
        </p>
      )}
      {preview.changes.length > 0 && (
        <div className="rounded-lg border p-2.5 text-xs space-y-1">
          <p className="font-medium">Saving this moves {preview.changes.length === 1 ? 'one pharmacy' : `${preview.changes.length} pharmacies`}:</p>
          <ul className="space-y-0.5">
            {preview.changes.map((change) => (
              <li key={change.pharmacyId}>
                {change.pharmacyName}: {change.fromZone ?? 'no zone'} → {' '}
                <span className={change.toZone ? '' : 'text-amber-700 font-medium'}>
                  {change.toZone ?? 'no zone'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
