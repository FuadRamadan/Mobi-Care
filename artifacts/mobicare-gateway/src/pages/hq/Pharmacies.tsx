import { useState } from 'react';
import {
  useListHqPharmacies,
  useOnboardPharmacy,
  useUpdateHqPharmacy,
  useResetPharmacyPassword,
  getListHqPharmaciesQueryKey,
  useListDeliveryZones,
  useLocateDeliveryZone,
  getListDeliveryZonesQueryKey,
  getLocateDeliveryZoneQueryKey,
  getPharmacyInventoryForHqTemplate,
  exportPharmacyInventoryForHq,
  previewPharmacyInventoryForHqImport,
  applyPharmacyInventoryForHqImport,
  type InventoryImportResult,
} from '@workspace/api-client-react';
import { BulkUploadDialog } from '@/components/BulkUploadDialog';
import { useQueryClient } from '@tanstack/react-query';
import HqLayout from './HqLayout';
import { EmptyState, formatDate } from './shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from '@/components/ui/dialog';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Copy, KeyRound, AlertTriangle, Pencil, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { LocationPicker } from '@/components/map/LocationPicker';

/**
 * Everything HQ records about a pharmacy beyond its login.
 *
 * The mobile money numbers are not optional extras: patients pay the pharmacy
 * directly, and checkout shows these numbers as the payment instruction. A
 * pharmacy onboarded without one cannot be paid at all, which is why they are
 * collected here and editable afterwards.
 */
const BLANK_DETAILS = {
  name: '',
  username: '',
  phone: '',
  email: '',
  address: '',
  orangeMoneyNumber: '',
  afriMoneyNumber: '',
  mobileMoneyAccountName: '',
  locationLat: '',
  locationLng: '',
};

type PharmacyDetails = typeof BLANK_DETAILS;

/** Empty strings mean "not provided", which the API expects as undefined. */
const orUndefined = (value: string) => (value.trim() ? value.trim() : undefined);
/** On an update, cleared means cleared — null, not "leave as it was". */
const orNull = (value: string) => (value.trim() ? value.trim() : null);

function DetailFields({
  form,
  setForm,
  showLogin,
}: {
  form: PharmacyDetails;
  setForm: (next: PharmacyDetails) => void;
  showLogin: boolean;
}) {
  const latitude = Number(form.locationLat);
  const longitude = Number(form.locationLng);
  const pin =
    form.locationLat.trim() && form.locationLng.trim() &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
      ? { latitude, longitude }
      : null;
  const field = (key: keyof PharmacyDetails) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <>
      <div className="space-y-1.5">
        <Label>Pharmacy name</Label>
        <Input required {...field('name')} data-testid="input-pharmacy-name" />
      </div>
      {showLogin && (
        <div className="space-y-1.5">
          <Label>Login username</Label>
          <Input required minLength={3} {...field('username')} data-testid="input-pharmacy-username" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Phone (optional)</Label>
          <Input {...field('phone')} data-testid="input-pharmacy-phone" />
        </div>
        <div className="space-y-1.5">
          <Label>Email (optional)</Label>
          <Input type="email" {...field('email')} data-testid="input-pharmacy-email" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Address (optional)</Label>
        <Input {...field('address')} data-testid="input-pharmacy-address" />
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <div>
          <p className="text-sm font-medium">Mobile money</p>
          <p className="text-xs text-muted-foreground">
            Shown to patients at checkout so they can pay the pharmacy directly.
            Record both lines where the pharmacy has both — a patient with only
            an AfriMoney wallet cannot pay an Orange Money number.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            With online payments, these are also the only numbers the pharmacy can cash out to.
            Changing one pauses cash-outs to it for 48 hours and alerts the pharmacy.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Orange Money line</Label>
            <Input {...field('orangeMoneyNumber')} placeholder="+232 76 000 000" data-testid="input-orange-money" />
          </div>
          <div className="space-y-1.5">
            <Label>AfriMoney line (optional)</Label>
            <Input {...field('afriMoneyNumber')} placeholder="+232 88 000 000" data-testid="input-afri-money" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Registered account name</Label>
          <Input {...field('mobileMoneyAccountName')} data-testid="input-money-account-name" />
        </div>
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <div>
          <p className="text-sm font-medium">Location</p>
          <p className="text-xs text-muted-foreground">
            Decides which delivery zone the pharmacy is in, and sorts search
            results by distance. Without it the pharmacy is collection only.
            When onboarding on site, stand inside the pharmacy and use this
            device&apos;s location.
          </p>
        </div>
        <LocationPicker
          value={pin}
          onChange={(next) =>
            setForm({
              ...form,
              locationLat: next.latitude.toFixed(6),
              locationLng: next.longitude.toFixed(6),
            })
          }
          locateLabel="Use this device's location"
          height={200}
          testId="map-pharmacy-location"
        />
        <ZoneLine pin={pin} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Latitude</Label>
            <Input inputMode="decimal" {...field('locationLat')} placeholder="8.4550" data-testid="input-latitude" />
          </div>
          <div className="space-y-1.5">
            <Label>Longitude</Label>
            <Input inputMode="decimal" {...field('locationLng')} placeholder="-13.2760" data-testid="input-longitude" />
          </div>
        </div>
      </div>
    </>
  );
}

/** Which delivery zone a pin falls in, worked out live as the pin moves. */
function ZoneLine({ pin }: { pin: { latitude: number; longitude: number } | null }) {
  const params = pin ?? { latitude: 0, longitude: 0 };
  const { data, isFetching } = useLocateDeliveryZone(params, {
    query: { queryKey: getLocateDeliveryZoneQueryKey(params), enabled: !!pin },
  });
  if (!pin) {
    return <p className="text-xs text-amber-700">No location yet — this pharmacy will be collection only.</p>;
  }
  if (isFetching && !data) return <p className="text-xs text-muted-foreground">Finding the delivery zone…</p>;
  return data?.zoneName ? (
    <p className="text-xs" data-testid="text-pharmacy-zone">
      Delivery zone: <span className="font-medium">{data.zoneName}</span>
      {data.feeMinor != null && <span className="text-muted-foreground"> · Le {(data.feeMinor / 100).toLocaleString('en-US')} per delivery</span>}
    </p>
  ) : (
    <p className="text-xs text-amber-700" data-testid="text-pharmacy-zone">
      Outside every delivery zone — this pharmacy will be collection only.
    </p>
  );
}

export default function HqPharmacies() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListHqPharmacies();
  const pharmacies = data ?? [];

  const { data: zoneData } = useListDeliveryZones();
  const zoneByPharmacy = new Map((zoneData?.pharmacies ?? []).map((p) => [p.id, p.zoneName]));
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListHqPharmaciesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListDeliveryZonesQueryKey() });
  };
  const onError = (err: unknown) =>
    toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'destructive' });

  const [openOnboard, setOpenOnboard] = useState(false);
  const [form, setForm] = useState({ ...BLANK_DETAILS });
  /** The pharmacy whose details are being edited, if any. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [stockFor, setStockFor] = useState<{ id: string; name: string } | null>(null);
  const [editForm, setEditForm] = useState({ ...BLANK_DETAILS });
  const [tempPasswordRes, setTempPasswordRes] = useState<{ tempPassword: string; temporaryPasswordExpiresAt: string } | null>(null);

  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const onboard = useOnboardPharmacy({
    mutation: {
      onSuccess: (res) => {
        setTempPasswordRes({ tempPassword: res.tempPassword, temporaryPasswordExpiresAt: res.temporaryPasswordExpiresAt });
        refresh();
      },
      onError,
    },
  });
  const update = useUpdateHqPharmacy({ mutation: { onSuccess: refresh, onError } });

  const resetPassword = useResetPharmacyPassword({
    mutation: {
      onSuccess: (res) => {
        setTempPasswordRes({ tempPassword: res.tempPassword, temporaryPasswordExpiresAt: res.temporaryPasswordExpiresAt });
        refresh();
        setResetConfirmOpen(false);
      },
      onError: (err) => {
        onError(err);
        setResetConfirmOpen(false);
      },
    },
  });

  const activeResetTarget = pharmacies.find(p => p.id === resetTargetId);

  return (
    <HqLayout title="Pharmacies">
      <div className="mb-4">
        <Dialog
          open={openOnboard || !!tempPasswordRes}
          onOpenChange={(v) => {
            if (!v && tempPasswordRes) return;
            if (!v) {
              setTempPasswordRes(null);
              setForm({ ...BLANK_DETAILS });
              setOpenOnboard(false);
            } else {
              setOpenOnboard(v);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button data-testid="button-onboard-pharmacy">Onboard pharmacy</Button>
          </DialogTrigger>
          <DialogContent
            className={`max-h-[85vh] overflow-y-auto${tempPasswordRes ? ' [&>button]:hidden' : ''}`}
            onEscapeKeyDown={(event) => {
              if (tempPasswordRes) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (tempPasswordRes) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>{tempPasswordRes ? 'Temporary Password Generated' : 'Onboard a pharmacy'}</DialogTitle>
              <DialogDescription>
                {tempPasswordRes
                  ? 'A one-time temporary password has been generated. Ensure you communicate it securely. It will not be shown again.'
                  : 'Create a new pharmacy account. A one-time temporary password will be generated.'}
              </DialogDescription>
            </DialogHeader>

            {tempPasswordRes ? (
              <div className="space-y-4 pt-2">
                <div className="p-4 bg-muted/50 border border-border rounded-lg space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Temporary Password</p>
                      <code className="font-mono text-xl tracking-tight font-bold text-foreground" data-testid="text-temp-password">
                        {tempPasswordRes.tempPassword}
                      </code>
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(tempPasswordRes.tempPassword);
                        toast({ title: 'Copied to clipboard' });
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded border border-amber-200 dark:border-amber-900/50">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>
                      This password expires on <strong>{format(new Date(tempPasswordRes.temporaryPasswordExpiresAt), 'PPP p')}</strong>.
                      The pharmacy must log in and change their password before this time.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={() => { setTempPasswordRes(null); setOpenOnboard(false); }} variant="default">
                    I have saved it securely
                  </Button>
                </div>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  onboard.mutate({
                    data: {
                      name: form.name,
                      username: form.username,
                      phone: orUndefined(form.phone),
                      email: orUndefined(form.email),
                      address: orUndefined(form.address),
                      orangeMoneyNumber: orUndefined(form.orangeMoneyNumber),
                      afriMoneyNumber: orUndefined(form.afriMoneyNumber),
                      mobileMoneyAccountName: orUndefined(form.mobileMoneyAccountName),
                      latitude: form.locationLat.trim() ? Number(form.locationLat) : undefined,
                      longitude: form.locationLng.trim() ? Number(form.locationLng) : undefined,
                    },
                  });
                }}
              >
                <DetailFields form={form} setForm={setForm} showLogin />
                <Button type="submit" disabled={onboard.isPending} className="w-full" data-testid="button-submit-onboard">
                  {onboard.isPending ? 'Creating…' : 'Create pharmacy account'}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Details can be wrong or missing after onboarding — most importantly a
          mobile money number, without which no patient can pay this pharmacy —
          so they have to be editable, not fixed at creation. */}
      <Dialog open={editing !== null} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {editing?.name}</DialogTitle>
            <DialogDescription>
              Update contact, payment and location details. The login username
              cannot be changed here.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!editing) return;
              update.mutate(
                {
                  id: editing.id,
                  data: {
                    name: editForm.name,
                    phone: orNull(editForm.phone),
                    email: orNull(editForm.email),
                    address: orNull(editForm.address),
                    orangeMoneyNumber: orNull(editForm.orangeMoneyNumber),
                    afriMoneyNumber: orNull(editForm.afriMoneyNumber),
                    mobileMoneyAccountName: orNull(editForm.mobileMoneyAccountName),
                    latitude: editForm.locationLat.trim() ? Number(editForm.locationLat) : null,
                    longitude: editForm.locationLng.trim() ? Number(editForm.locationLng) : null,
                  },
                },
                { onSuccess: () => setEditing(null) },
              );
            }}
          >
            <DetailFields form={editForm} setForm={setEditForm} showLogin={false} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={update.isPending} data-testid="button-save-pharmacy">
                {update.isPending ? 'Saving…' : 'Save details'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Pharmacy Password</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reset the password for <strong>{activeResetTarget?.name}</strong>?
              <br/><br/>
              This will immediately invalidate their current password and disconnect active sessions. A new temporary password will be generated that you must relay to them securely.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetPassword.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetPassword.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (resetTargetId) {
                  resetPassword.mutate({ id: resetTargetId });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetPassword.isPending ? 'Resetting...' : 'Yes, Reset Password'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : pharmacies.length === 0 ? (
        <EmptyState>No pharmacies yet — onboard the first one.</EmptyState>
      ) : (
        <div className="border rounded-xl bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pharmacy</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Zone</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Online</TableHead>
                <TableHead>Tier 1 authorised</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pharmacies.map((p) => (
                <TableRow key={p.id} data-testid={`row-pharmacy-${p.id}`}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.address ?? '—'}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.username}</TableCell>
                  <TableCell>{p.phone ?? '—'}</TableCell>
                  <TableCell className="text-xs" data-testid={`text-zone-${p.id}`}>
                    {zoneByPharmacy.get(p.id) ?? (
                      <span className="text-amber-700">Collection only</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* A pharmacy with no mobile money line cannot take an
                        order: checkout has no number to show the patient. That
                        is worth flagging here rather than discovering at
                        checkout. */}
                    {p.orangeMoneyNumber || p.afriMoneyNumber || p.mobileMoneyNumber ? (
                      <div className="text-xs space-y-0.5">
                        {p.orangeMoneyNumber && <div>Orange {p.orangeMoneyNumber}</div>}
                        {p.afriMoneyNumber && <div>AfriMoney {p.afriMoneyNumber}</div>}
                        {!p.orangeMoneyNumber && !p.afriMoneyNumber && p.mobileMoneyNumber && (
                          <div className="text-muted-foreground">{p.mobileMoneyNumber}</div>
                        )}
                      </div>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-900 gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        No number
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={p.isActive}
                        disabled={update.isPending}
                        onCheckedChange={(v) => update.mutate({ id: p.id, data: { isActive: v } })}
                        data-testid={`switch-active-${p.id}`}
                      />
                      <Badge variant="secondary" className={p.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                        {p.isActive ? 'online' : 'offline'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.controlledSubstanceAuthorized}
                      disabled={update.isPending}
                      onCheckedChange={(v) => update.mutate({ id: p.id, data: { controlledSubstanceAuthorized: v } })}
                      data-testid={`switch-tier1-${p.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5 h-8 w-full border-border/60"
                        onClick={() => {
                          setEditForm({
                            ...BLANK_DETAILS,
                            name: p.name,
                            username: p.username,
                            phone: p.phone ?? '',
                            email: p.email ?? '',
                            address: p.address ?? '',
                            orangeMoneyNumber: p.orangeMoneyNumber ?? '',
                            afriMoneyNumber: p.afriMoneyNumber ?? '',
                            mobileMoneyAccountName: p.mobileMoneyAccountName ?? '',
                            locationLat: p.latitude == null ? '' : String(p.latitude),
                            locationLng: p.longitude == null ? '' : String(p.longitude),
                          });
                          setEditing({ id: p.id, name: p.name });
                        }}
                        data-testid={`button-edit-pharmacy-${p.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5 h-8 w-full border-border/60"
                        onClick={() => setStockFor({ id: p.id, name: p.name })}
                        data-testid={`button-upload-stock-${p.id}`}
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        Stock upload
                      </Button>
                      {p.isActive ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs gap-1.5 h-8 w-full border-border/60 hover:bg-destructive/5 hover:text-destructive hover:border-destructive/30"
                          onClick={() => {
                            setResetTargetId(p.id);
                            setResetConfirmOpen(true);
                          }}
                          data-testid={`button-reset-password-${p.id}`}
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Reset
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground px-2">Inactive</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {stockFor && (
        <BulkUploadDialog<InventoryImportResult>
          open
          onOpenChange={(open) => !open && setStockFor(null)}
          title={`Stock upload for ${stockFor.name}`}
          description="Upload this pharmacy's inventory on its behalf. The same checks apply as when the pharmacy uploads it, and the upload is recorded in the audit log under your name."
          getTemplate={() => getPharmacyInventoryForHqTemplate(stockFor.id)}
          getExport={() => exportPharmacyInventoryForHq(stockFor.id)}
          exportLabel="Export its inventory"
          preview={(upload) => previewPharmacyInventoryForHqImport(stockFor.id, upload)}
          apply={(body) => applyPharmacyInventoryForHqImport(stockFor.id, body)}
          describeResult={(result) => [
            `${result.added} new listing${result.added === 1 ? '' : 's'} added`,
            `${result.updated} listing${result.updated === 1 ? '' : 's'} updated`,
            ...(result.removed ? [`${result.removed} taken down`] : []),
            ...(result.sentForReview ? [`${result.sentForReview} new medicine${result.sentForReview === 1 ? '' : 's'} waiting in Catalogue → Held`] : []),
            ...(result.skipped ? [`${result.skipped} duplicate${result.skipped === 1 ? '' : 's'} skipped`] : []),
            ...(result.unchanged ? [`${result.unchanged} unchanged`] : []),
            ...(result.failed ? [`${result.failed} row${result.failed === 1 ? '' : 's'} not saved because of problems`] : []),
          ]}
        />
      )}
    </HqLayout>
  );
}
