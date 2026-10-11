import { useEffect, useMemo, useState } from "react";
import { 
  useListPrescriptions,
  useApprovePrescription,
  useRejectPrescription,
  Prescription,
  PrescriptionStatus,
  PrescriptionRejectionReason,
  useListInventory,
  getListPrescriptionsQueryKey,
  getGetAnalyticsOverviewQueryKey,
} from "@workspace/api-client-react";
import { formatDateTime, formatTime } from "@/lib/format";
import { fetchPrescriptionFile, PrescriptionFileError, saveToComputer } from "@/lib/prescriptionFile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileImage, Search, CheckCircle, XCircle, Clock, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function Prescriptions() {
  const [activeTab, setActiveTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: prescriptions, isLoading } = useListPrescriptions(undefined, {
    query: { queryKey: getListPrescriptionsQueryKey(), refetchInterval: 15_000 },
  });
  // Looked up from the list on every refresh, so a download or the file's
  // removal shows in the open review without closing it.
  const selectedPrescription = prescriptions?.find((p) => p.id === selectedId) ?? null;

  const filteredPrescriptions = prescriptions?.filter(p => {
    if (search && !p.patientName.toLowerCase().includes(search.toLowerCase()) && 
        !p.patientPhone.includes(search)) {
      return false;
    }
    if (activeTab !== "all") {
      return p.status === activeTab;
    }
    return true;
  }) || [];

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prescriptions</h1>
          <p className="text-muted-foreground mt-1 text-sm">Review and authorize patient prescription uploads.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-card p-2 rounded-lg border shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="pending">Pending Review</TabsTrigger>
            <TabsTrigger value="all">All Prescriptions</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search patient..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
              <TableRow>
                <TableHead>Date Uploaded</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-5 w-32 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-5 w-32 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-5 w-24 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-6 w-20 bg-muted animate-pulse rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : filteredPrescriptions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-48 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <FileImage className="w-8 h-8 text-muted-foreground/50" />
                      <p>No prescriptions found.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredPrescriptions.map((p) => (
                  <TableRow 
                    key={p.id} 
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedId(p.id)}
                  >
                    <TableCell className="text-sm font-medium">{formatDateTime(p.createdAt)}</TableCell>
                    <TableCell className="text-sm">{p.patientName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.patientPhone}</TableCell>
                    <TableCell>
                      <Badge variant={
                        p.status === 'approved' ? 'default' : 
                        p.status === 'rejected' ? 'destructive' : 'secondary'
                      } className={p.status === 'approved' ? 'bg-green-600 hover:bg-green-700' : ''}>
                        {p.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <PrescriptionReviewSheet 
        prescription={selectedPrescription} 
        onClose={() => setSelectedId(null)} 
      />
    </div>
  );
}

function PrescriptionReviewSheet({ prescription, onClose }: { prescription: Prescription | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const approve = useApprovePrescription();
  const reject = useRejectPrescription();
  
  const { data: inventory } = useListInventory();
  
  const [selectedDrugs, setSelectedDrugs] = useState<Set<string>>(new Set());
  const [rejectReason, setRejectReason] = useState<PrescriptionRejectionReason | "">("");
  const [rejectNote, setRejectNote] = useState("");
  const [viewMode, setViewMode] = useState<"details" | "approve" | "reject">("details");

  if (!prescription) return <Sheet open={false} onOpenChange={onClose}><SheetContent /></Sheet>;

  // Reset state when opening a new prescription
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setViewMode("details");
      setSelectedDrugs(new Set());
      setRejectReason("");
      setRejectNote("");
      onClose();
    }
  };

  const handleApprove = async () => {
    if (selectedDrugs.size === 0) {
      toast.error("Select at least one drug to approve");
      return;
    }
    try {
      await approve.mutateAsync({ 
        id: prescription.id, 
        data: { approvedDrugIds: Array.from(selectedDrugs) } 
      });
      toast.success("Prescription approved");
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/prescriptions"] });
      queryClient.invalidateQueries({ queryKey: getGetAnalyticsOverviewQueryKey() });
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to approve prescription");
    }
  };

  const handleReject = async () => {
    if (!rejectReason) {
      toast.error("Select a rejection reason");
      return;
    }
    try {
      await reject.mutateAsync({ 
        id: prescription.id, 
        data: { reason: rejectReason as PrescriptionRejectionReason, note: rejectNote } 
      });
      toast.success("Prescription rejected");
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/prescriptions"] });
      queryClient.invalidateQueries({ queryKey: getGetAnalyticsOverviewQueryKey() });
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to reject prescription");
    }
  };

  return (
    <Sheet open={!!prescription} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full max-w-full sm:w-[540px] overflow-y-auto bg-card border-l flex flex-col p-0">
        <div className="p-6 border-b bg-muted/20">
          <SheetHeader>
            <div className="flex items-center justify-between mb-2">
              <SheetTitle className="text-xl">Prescription Review</SheetTitle>
              <Badge variant={
                prescription.status === 'approved' ? 'default' : 
                prescription.status === 'rejected' ? 'destructive' : 'secondary'
              } className={prescription.status === 'approved' ? 'bg-green-600 hover:bg-green-700' : ''}>
                {prescription.status}
              </Badge>
            </div>
            <SheetDescription>
              Uploaded {formatDateTime(prescription.createdAt)}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="p-6 flex-1 flex flex-col">
          {viewMode === "details" && (
            <div className="space-y-8 flex-1">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Patient Details</h3>
                <div className="bg-muted/30 rounded-lg p-4 space-y-2 border">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Name</span>
                    <span className="text-sm font-medium">{prescription.patientName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Phone</span>
                    <span className="text-sm font-medium">{prescription.patientPhone}</span>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Document</h3>
                <PrescriptionDocument prescription={prescription} />
              </section>

              {prescription.status === "rejected" && (
                <section className="space-y-3 mt-6">
                  <div className="bg-destructive/10 p-4 rounded-lg border border-destructive/20">
                    <h4 className="text-sm font-bold text-destructive flex items-center gap-2 mb-2">
                      <XCircle className="w-4 h-4" /> Rejection Details
                    </h4>
                    <p className="text-sm font-medium">{prescription.rejectReason}</p>
                    {prescription.rejectNote && (
                      <p className="text-sm text-muted-foreground mt-1">{prescription.rejectNote}</p>
                    )}
                  </div>
                </section>
              )}

              {prescription.status === "approved" && (
                <section className="space-y-3 mt-6">
                  <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-900">
                    <h4 className="text-sm font-bold text-green-700 dark:text-green-400 flex items-center gap-2 mb-2">
                      <CheckCircle className="w-4 h-4" /> Approved Drugs
                    </h4>
                    <ul className="text-sm space-y-1 list-disc list-inside pl-4 text-green-800 dark:text-green-300">
                      {prescription.approvedDrugIds?.map(id => {
                        const drug = inventory?.find(i => i.drugId === id)?.drug;
                        return <li key={id}>{drug ? drug.name : 'Unknown Drug'}</li>;
                      })}
                    </ul>
                  </div>
                </section>
              )}
            </div>
          )}

          {viewMode === "approve" && (
            <div className="space-y-6 flex-1">
              <div className="space-y-2">
                <h3 className="font-semibold">Select Approved Drugs</h3>
                <p className="text-sm text-muted-foreground">
                  Check the boxes for the specific drugs from your inventory that you are authorizing to fill this prescription.
                </p>
              </div>

              <ApprovedMedicinePicker
                inventory={inventory ?? []}
                requestedDrugIds={new Set((prescription.requestedItems ?? []).map((item) => item.drugId))}
                selected={selectedDrugs}
                onChange={setSelectedDrugs}
              />
            </div>
          )}

          {viewMode === "reject" && (
            <div className="space-y-6 flex-1">
              <div className="space-y-2">
                <h3 className="font-semibold">Reject Prescription</h3>
                <p className="text-sm text-muted-foreground">
                  Select a reason for rejecting this prescription upload. This will be shown to the patient.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Rejection Reason</Label>
                  <Select value={rejectReason} onValueChange={(val: any) => setRejectReason(val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PrescriptionRejectionReason.illegible_image}>Image is illegible</SelectItem>
                      <SelectItem value={PrescriptionRejectionReason.expired_prescription}>Prescription has expired</SelectItem>
                      <SelectItem value={PrescriptionRejectionReason.invalid_prescription}>Invalid or forged prescription</SelectItem>
                      <SelectItem value={PrescriptionRejectionReason.drug_unavailable}>Requested drug(s) unavailable</SelectItem>
                      <SelectItem value={PrescriptionRejectionReason.controlled_substance_not_authorized}>Not authorized for controlled substances</SelectItem>
                      <SelectItem value={PrescriptionRejectionReason.patient_mismatch}>Patient details mismatch</SelectItem>
                      <SelectItem value={PrescriptionRejectionReason.quantity_exceeded}>Quantity requested exceeds prescription</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Additional Note (Optional)</Label>
                  <Textarea 
                    placeholder="Provide any additional context for the patient..."
                    value={rejectNote}
                    onChange={e => setRejectNote(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {prescription.status === "pending" && (
            <div className="mt-8 pt-4 border-t flex flex-col gap-2 shrink-0">
              {viewMode === "details" ? (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-white" onClick={() => setViewMode("reject")}>
                    Reject
                  </Button>
                  <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setViewMode("approve")}>
                    Approve
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setViewMode("details")}>
                    Back
                  </Button>
                  {viewMode === "approve" ? (
                    <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleApprove} disabled={approve.isPending}>
                      Confirm Approval
                    </Button>
                  ) : (
                    <Button className="flex-1 bg-destructive hover:bg-destructive/90 text-white" onClick={handleReject} disabled={reject.isPending}>
                      Confirm Rejection
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The prescription image, shown in the page, with a button to save it to this
 * computer. MobiCare deletes its copy 15 minutes after the first download, so
 * once it is gone the pharmacist is pointed to the saved copy.
 */
function PrescriptionDocument({ prescription }: { prescription: Prescription }) {
  const queryClient = useQueryClient();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const removed = Boolean(prescription.fileDeletedAt);

  useEffect(() => {
    if (removed) return;
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    setError(null);
    fetchPrescriptionFile(prescription.id, false)
      .then(({ blob }) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImageUrl(url);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof PrescriptionFileError ? e.message : "The prescription image could not be loaded. Try again.");
        // Removed between the list loading and now: show that, not an error.
        if (e instanceof PrescriptionFileError && e.code === "PRESCRIPTION_FILE_REMOVED") {
          void queryClient.invalidateQueries({ queryKey: getListPrescriptionsQueryKey() });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setImageUrl(null);
    };
  }, [prescription.id, removed, queryClient]);

  const handleDownload = async () => {
    setSaving(true);
    try {
      const { blob, filename } = await fetchPrescriptionFile(prescription.id, true);
      saveToComputer(blob, filename);
      toast.success(
        prescription.downloadedAt
          ? "Saved to this computer again."
          : "Saved to this computer. MobiCare deletes its copy in 15 minutes.",
      );
      await queryClient.invalidateQueries({ queryKey: getListPrescriptionsQueryKey() });
    } catch (e: unknown) {
      toast.error(e instanceof PrescriptionFileError ? e.message : "Could not download the prescription. Try again.");
      await queryClient.invalidateQueries({ queryKey: getListPrescriptionsQueryKey() });
    } finally {
      setSaving(false);
    }
  };

  if (removed) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm space-y-1" data-testid="prescription-file-removed">
        <p className="font-medium flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-muted-foreground" /> Removed from MobiCare
        </p>
        <p className="text-muted-foreground">
          Downloaded {prescription.downloadedAt ? formatDateTime(prescription.downloadedAt) : "earlier"}, removed{" "}
          {formatDateTime(prescription.fileDeletedAt!)}. Use the copy saved on your pharmacy's computer.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/30 min-h-48 flex items-center justify-center overflow-hidden">
        {loading ? (
          <span className="text-sm text-muted-foreground">Loading the prescription…</span>
        ) : error ? (
          <div className="p-4 text-center space-y-2">
            <p className="text-sm text-destructive" data-testid="prescription-file-error">{error}</p>
          </div>
        ) : imageUrl ? (
          // A direct link to the image already in the page: opening it is
          // part of the click, so no browser blocks it.
          <a href={imageUrl} target="_blank" rel="noopener" title="Open full size" className="block w-full">
            <img src={imageUrl} alt="Prescription uploaded by the patient" className="w-full max-h-[420px] object-contain bg-white" data-testid="prescription-image" />
          </a>
        ) : (
          <FileImage className="w-8 h-8 text-muted-foreground/50" />
        )}
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={handleDownload} disabled={saving || Boolean(error && !imageUrl)} data-testid="button-download-prescription">
          <Download className="w-4 h-4 mr-2" />
          {saving ? "Saving…" : prescription.downloadedAt ? "Download again" : "Download to this computer"}
        </Button>
        {imageUrl && (
          <Button variant="outline" asChild>
            <a href={imageUrl} target="_blank" rel="noopener">
              <ExternalLink className="w-4 h-4 mr-1" /> Full size
            </a>
          </Button>
        )}
      </div>

      {prescription.downloadedAt && prescription.fileDeletesAt ? (
        <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5" data-testid="prescription-file-countdown">
          <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Downloaded {formatTime(prescription.downloadedAt)}. MobiCare deletes its copy at {formatTime(prescription.fileDeletesAt)}; keep the downloaded file for your records.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Save a copy for your records. MobiCare deletes the image 15 minutes after the first download.
        </p>
      )}
    </div>
  );
}

/** One medicine on the picker, with the brands this pharmacy stocks of it. */
interface PickerMedicine {
  drugId: string;
  name: string;
  genericName: string | null;
  tier: string | null;
  brands: string[];
  requested: boolean;
}

/**
 * The medicines a pharmacist can approve, with a search box: a pharmacy with
 * hundreds of listings could not find one by scrolling. One row per medicine
 * (approval is per medicine, whatever the brand); medicines on the patient's
 * order come first.
 */
function ApprovedMedicinePicker({
  inventory,
  requestedDrugIds,
  selected,
  onChange,
}: {
  inventory: Array<{ drugId: string; isActive: boolean; brand?: string | null; drug: { name: string; genericName?: string | null; tier?: string | null } }>;
  requestedDrugIds: Set<string>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");

  const medicines = useMemo(() => {
    const byDrug = new Map<string, PickerMedicine>();
    for (const item of inventory) {
      if (!item.isActive) continue;
      const entry = byDrug.get(item.drugId) ?? {
        drugId: item.drugId,
        name: item.drug.name,
        genericName: item.drug.genericName ?? null,
        tier: item.drug.tier ?? null,
        brands: [],
        requested: requestedDrugIds.has(item.drugId),
      };
      if (item.brand && !entry.brands.includes(item.brand)) entry.brands.push(item.brand);
      byDrug.set(item.drugId, entry);
    }
    return [...byDrug.values()].sort(
      (a, b) => Number(b.requested) - Number(a.requested) || a.name.localeCompare(b.name),
    );
    // requestedDrugIds is rebuilt on each render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, [...requestedDrugIds].join(",")]);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length
    ? medicines.filter((m) => {
        const text = [m.name, m.genericName ?? "", ...m.brands].join(" ").toLowerCase();
        return words.every((w) => text.includes(w));
      })
    : medicines;

  const toggle = (drugId: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(drugId);
    else next.delete(drugId);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          autoFocus
          placeholder="Search your medicines by name, generic name or brand…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
          data-testid="input-search-approve-medicines"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {selected.size > 0 ? `${selected.size} selected · ` : ""}
        {words.length ? `${shown.length} of ${medicines.length} medicines` : `${medicines.length} medicines`}
      </p>
      <div className="border rounded-md max-h-[340px] overflow-y-auto divide-y">
        {shown.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground text-center">No medicine in your stock matches "{query.trim()}".</p>
        ) : (
          shown.map((m) => (
            <div key={m.drugId} className="flex items-center gap-3 p-3 hover:bg-muted/30">
              <Checkbox
                id={`drug-${m.drugId}`}
                checked={selected.has(m.drugId)}
                onCheckedChange={(checked) => toggle(m.drugId, checked === true)}
              />
              <Label htmlFor={`drug-${m.drugId}`} className="flex-1 cursor-pointer">
                <div className="font-medium text-sm">{m.name}</div>
                <div className="text-xs text-muted-foreground">
                  {[m.genericName, m.brands.length ? `Brands: ${m.brands.join(", ")}` : null].filter(Boolean).join(" · ") || "—"}
                </div>
              </Label>
              {m.requested && (
                <Badge variant="secondary" className="text-[10px]">On this order</Badge>
              )}
              {m.tier === "1" && (
                <Badge variant="destructive" className="text-[10px]">Rx Only</Badge>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
