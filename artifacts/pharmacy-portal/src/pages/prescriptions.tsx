import { useState } from "react";
import { 
  useListPrescriptions,
  useGetPrescriptionImageUrl,
  useApprovePrescription,
  useRejectPrescription,
  Prescription,
  PrescriptionStatus,
  PrescriptionRejectionReason,
  useListInventory,
  getListPrescriptionsQueryKey,
  getGetAnalyticsOverviewQueryKey,
} from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileImage, FileText, Search, CheckCircle, XCircle } from "lucide-react";
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
  const [selectedPrescription, setSelectedPrescription] = useState<Prescription | null>(null);

  const { data: prescriptions, isLoading } = useListPrescriptions(undefined, {
    query: { queryKey: getListPrescriptionsQueryKey(), refetchInterval: 15_000 },
  });

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
                    onClick={() => setSelectedPrescription(p)}
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
        onClose={() => setSelectedPrescription(null)} 
      />
    </div>
  );
}

function PrescriptionReviewSheet({ prescription, onClose }: { prescription: Prescription | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const getImageUrl = useGetPrescriptionImageUrl();
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

  const handleViewImage = async () => {
    try {
      const res = await getImageUrl.mutateAsync({ id: prescription.id, data: { variant: "full" } });
      window.open(res.url, "_blank");
    } catch (e: any) {
      toast.error(e.message || "Failed to load image URL");
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
                <Button 
                  variant="outline" 
                  className="w-full h-24 border-dashed flex flex-col gap-2 hover:bg-muted/50 transition-colors"
                  onClick={handleViewImage}
                  disabled={getImageUrl.isPending}
                >
                  <FileImage className="w-6 h-6 text-muted-foreground" />
                  <span className="font-medium text-primary flex items-center gap-1">
                    {getImageUrl.isPending ? "Loading..." : "Open Secure Image Viewer"}
                    <ExternalLink className="w-3 h-3" />
                  </span>
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Image opens in a secure, signed URL that expires in 5 minutes.
                </p>
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

              <div className="border rounded-md max-h-[300px] overflow-y-auto divide-y">
                {inventory?.filter(i => i.isActive).map(item => (
                  <div key={item.drugId} className="flex items-center gap-3 p-3 hover:bg-muted/30">
                    <Checkbox 
                      id={`drug-${item.drugId}`} 
                      checked={selectedDrugs.has(item.drugId)}
                      onCheckedChange={(checked) => {
                        const newSet = new Set(selectedDrugs);
                        if (checked) newSet.add(item.drugId);
                        else newSet.delete(item.drugId);
                        setSelectedDrugs(newSet);
                      }}
                    />
                    <Label htmlFor={`drug-${item.drugId}`} className="flex-1 cursor-pointer">
                      <div className="font-medium text-sm">{item.drug.name}</div>
                      <div className="text-xs text-muted-foreground">{item.drug.genericName || "—"}</div>
                    </Label>
                    {item.drug.tier === '1' && (
                      <Badge variant="destructive" className="text-[10px]">Rx Only</Badge>
                    )}
                  </div>
                ))}
              </div>
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
