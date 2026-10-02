import { useState, useEffect } from "react";
import {
  useListHqDrugs,
  useCreateHqDrug,
  useUpdateHqDrug,
  useDeleteHqDrug,
  useListHqDrugCategories,
  useApproveHqDrugs,
  getListHqDrugsQueryKey,
  type HqDrug,
  type DrugVariant,
  type HqDrugApprovalResult,
  type DrugPrimaryCategory,
  type DrugSubcategory,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import HqLayout from "./HqLayout";
import { useHqAuth } from "@/hq/auth";
import { BulkUploadDialog } from "@/components/BulkUploadDialog";
import {
  getCatalogueTemplate,
  exportCatalogue,
  previewCatalogueImport,
  applyCatalogueImport,
  type CatalogueImportResult,
} from "@workspace/api-client-react";
import { EmptyState } from "./shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { format, isPast, parseISO } from "date-fns";
import { Trash2 } from "lucide-react";

const TIER_LABEL: Record<string, string> = {
  "1": "Tier 1 · Controlled",
  "2": "Tier 2 · Prescription",
  "3": "Tier 3 · OTC",
};

const FORM_OPTIONS = ["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Infusion", "Cream", "Ointment", "Gel", "Drops", "Inhaler", "Suppository", "Powder", "Patch"];
const UNIT_OPTIONS = ["Box", "Bottle", "Vial", "Sachet", "Tablet", "Capsule", "Strip", "Tube", "Ampoule", "Syringe", "Pack", "Carton", "Jar", "Can", "Roll", "Piece"];

const splitList = (text: string) => text.split(",").map((value) => value.trim()).filter(Boolean);
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** A strength + form combination, compared ignoring capitals. */
const pairKey = (strength: string, form: string) => `${strength.trim().toLowerCase()}|${form.trim().toLowerCase()}`;

/** "500mg Tablet, 125mg/5ml Syrup", shortened after a few. */
function availableAs(drug: HqDrug): string {
  const pairs: string[] = drug.variants?.length
    ? drug.variants.map((variant: DrugVariant) => `${variant.strength} ${variant.form}`)
    : [`${drug.commonStrengths.join(", ")} · ${drug.commonForms.join(", ")}`];
  return pairs.length > 4 ? `${pairs.slice(0, 4).join(", ")} +${pairs.length - 4} more` : pairs.join(", ");
}

const DEFAULT_FORM = {
  name: "",
  genericName: "",
  tier: "3",
  unit: "",
  maxUnits: "",
  primaryCategory: "",
  subcategory: "",
  commonStrengths: "",
  commonForms: "",
  /** Combinations of the strengths and forms above that it does NOT come in. */
  unavailable: [] as string[],
};

export default function HqCatalogue() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useHqAuth();
  const canEdit = user?.canManageCatalogue !== false;
  const [bulkOpen, setBulkOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "held">("all");
  const drugParams = tab === "held" ? { status: "held" as const } : undefined;
  const { data, isLoading } = useListHqDrugs(
    drugParams,
    {
      query: {
        queryKey: getListHqDrugsQueryKey(drugParams),
        refetchInterval: 15_000,
      },
    },
  );
  const { data: categories = [] } = useListHqDrugCategories();
  const drugs = data ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListHqDrugsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/catalogue"] });
  };
  const onError = (err: unknown) =>
    toast({
      title: "Action failed",
      description: err instanceof Error ? err.message : "Please try again",
      variant: "destructive",
    });
  const create = useCreateHqDrug({ mutation: { onSuccess: refresh, onError } });
  const update = useUpdateHqDrug({ mutation: { onSuccess: refresh, onError } });
  const deleteDrug = useDeleteHqDrug();

  const [open, setOpen] = useState(false);
  const [editDrug, setEditDrug] = useState<HqDrug | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const selectedCategory = categories.find((category) => category.value === form.primaryCategory);

  const categoryLabel = (value: string | null | undefined) =>
    categories.find((category) => category.value === value)?.label ?? "—";
  const subcategoryLabel = (value: string | null | undefined) =>
    categories.flatMap((category) => category.subcategories).find((sub) => sub.value === value)?.label ?? "—";

  const strengthList = splitList(form.commonStrengths);
  const formList = splitList(form.commonForms);
  const formOptions = [...FORM_OPTIONS, ...formList.filter((value) => !FORM_OPTIONS.some((option) => sameText(option, value)))];

  // Approving many held medicines at once (after a bulk catalogue upload).
  const [selected, setSelected] = useState<string[]>([]);
  const [approvalResult, setApprovalResult] = useState<HqDrugApprovalResult | null>(null);
  const approve = useApproveHqDrugs();
  useEffect(() => setSelected([]), [tab]);
  const heldIds = tab === "held" ? drugs.filter((d) => d.reviewStatus === "pending").map((d) => d.id) : [];
  const approveSelected = async () => {
    const ids = selected.filter((id) => heldIds.includes(id));
    if (!ids.length) return;
    if (!window.confirm(`Approve ${ids.length} medicine${ids.length === 1 ? "" : "s"}? Pharmacies can list ${ids.length === 1 ? "it" : "them"} straight away, at the tier and category shown.`)) return;
    try {
      const result = await approve.mutateAsync({ data: { ids } });
      refresh();
      setSelected([]);
      if (result.notApproved.length) setApprovalResult(result);
      else toast({ title: `${result.approved} medicine${result.approved === 1 ? "" : "s"} approved` });
    } catch (error) {
      onError(error);
    }
  };

  const [rejectDrug, setRejectDrug] = useState<HqDrug | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const handleDelete = async (drug: HqDrug) => {
    if (
      !window.confirm(
        `Delete ${drug.name} from the MobiCare catalogue? Existing historical order records will be preserved.`,
      )
    ) {
      return;
    }
    try {
      const result = await deleteDrug.mutateAsync({ id: drug.id });
      refresh();
      toast({
        title: "Drug removed",
        description:
          result.mode === "retired"
            ? "The drug and linked pharmacy listings were retired while historical records were preserved."
            : "The unused drug was deleted from the catalogue.",
      });
    } catch (error) {
      onError(error);
    }
  };

  useEffect(() => {
    if (editDrug) {
      setForm({
        name: editDrug.name,
        genericName: editDrug.genericName || "",
        tier: editDrug.tier,
        unit: editDrug.unit || "",
        maxUnits: editDrug.maxUnitsPerOrder
          ? String(editDrug.maxUnitsPerOrder)
          : "",
        primaryCategory: editDrug.primaryCategory || "",
        subcategory: editDrug.subcategory || "",
        commonStrengths: (editDrug.commonStrengths || []).join(", "),
        commonForms: (editDrug.commonForms || []).join(", "),
        unavailable: editDrug.variants?.length
          ? (editDrug.commonStrengths || []).flatMap((strength) =>
              (editDrug.commonForms || [])
                .filter((dosageForm) => !editDrug.variants!.some((variant) => pairKey(variant.strength, variant.form) === pairKey(strength, dosageForm)))
                .map((dosageForm) => pairKey(strength, dosageForm)),
            )
          : [],
      });
      setOpen(true);
    } else if (!open) {
      setForm(DEFAULT_FORM);
    }
  }, [editDrug, open]);

  const isNew = !editDrug;
  const isPending = editDrug?.reviewStatus === "pending";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (form.tier === "1" && !form.maxUnits) {
      toast({
        title: "Cap required",
        description: "Tier 1 requires a max units cap",
        variant: "destructive",
      });
      return;
    }
    if (
      !form.primaryCategory ||
      !form.subcategory ||
      !form.commonStrengths ||
      !form.commonForms
    ) {
      toast({
        title: "Missing fields",
        description:
          "Category, subcategory, strengths, and forms are required.",
        variant: "destructive",
      });
      return;
    }

    const variants = formList.flatMap((dosageForm) =>
      strengthList
        .filter((strength) => !form.unavailable.includes(pairKey(strength, dosageForm)))
        .map((strength) => ({ strength, form: dosageForm })),
    );
    if (!variants.length) {
      toast({
        title: "Nothing available",
        description: "Tick at least one strength and form combination.",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      name: form.name,
      genericName: form.genericName || undefined,
      tier: form.tier as "1" | "2" | "3",
      unit: form.unit || undefined,
      maxUnitsPerOrder: form.maxUnits ? Number(form.maxUnits) : null,
      primaryCategory: form.primaryCategory as DrugPrimaryCategory,
      subcategory: form.subcategory as DrugSubcategory,
      // The combinations decide the strength and form lists on the server.
      variants,
    };

    if (isNew) {
      create.mutate({ data: payload }, { onSuccess: () => setOpen(false) });
    } else {
      const updateData: Parameters<typeof update.mutate>[0]["data"] = {
        ...payload,
        genericName: payload.genericName ?? null,
      };
      if (isPending) {
        updateData.isApproved = true;
        updateData.reviewStatus = "approved";
      }
      update.mutate(
        { id: editDrug.id, data: updateData },
        {
          onSuccess: () => {
            setOpen(false);
            setEditDrug(null);
          },
        },
      );
    }
  };

  return (
    <HqLayout title="Master Catalogue">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "held")}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all-drugs">
              All drugs
            </TabsTrigger>
            <TabsTrigger value="held" data-testid="tab-held-drugs">
              Held (proposals)
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {canEdit && (
        <div className="flex gap-2">
        <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="button-bulk-catalogue">
          Bulk upload
        </Button>
        <BulkUploadDialog<CatalogueImportResult>
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          title="Bulk upload the catalogue"
          description="Add or update many medicines at once. New medicines are saved held until someone confirms their tier."
          getTemplate={() => getCatalogueTemplate()}
          getExport={() => exportCatalogue()}
          exportLabel="Export the catalogue"
          preview={(upload) => previewCatalogueImport(upload)}
          apply={(body) => applyCatalogueImport(body)}
          describeResult={(result) => [
            `${result.added} new medicine${result.added === 1 ? "" : "s"} saved held: confirm their tiers in the Held tab`,
            `${result.updated} entr${result.updated === 1 ? "y" : "ies"} updated`,
            ...(result.listingsTakenDown ? [`${result.listingsTakenDown} listing${result.listingsTakenDown === 1 ? "" : "s"} taken down at pharmacies not authorised for controlled medicines`] : []),
            ...(result.skipped ? [`${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped`] : []),
            ...(result.unchanged ? [`${result.unchanged} unchanged`] : []),
            ...(result.failed ? [`${result.failed} row${result.failed === 1 ? "" : "s"} not saved because of problems`] : []),
          ]}
          onSaved={refresh}
        />
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setEditDrug(null);
          }}
        >
          <DialogTrigger asChild>
            <Button data-testid="button-add-drug">Add drug</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {isNew
                  ? "Add drug to master catalogue"
                  : isPending
                    ? "Review Drug Proposal"
                    : "Edit Drug"}
              </DialogTitle>
              <DialogDescription>
                Tier 1 (controlled) drugs require a max-units-per-order cap.
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4 py-2" onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    data-testid="input-drug-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Generic name (optional)</Label>
                  <Input
                    value={form.genericName}
                    onChange={(e) =>
                      setForm({ ...form, genericName: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Primary Category</Label>
                  <Select
                    value={form.primaryCategory}
                    onValueChange={(v) =>
                      setForm({ ...form, primaryCategory: v, subcategory: "" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category.value} value={category.value}>
                          {category.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Subcategory</Label>
                  <Select
                    value={form.subcategory}
                    onValueChange={(v) => setForm({ ...form, subcategory: v })}
                    disabled={!form.primaryCategory}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select subcategory..." />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedCategory?.subcategories.map((subcategory) => (
                        <SelectItem key={subcategory.value} value={subcategory.value}>
                          {subcategory.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Packaging / Unit</Label>
                  <Select
                    value={form.unit}
                    onValueChange={(v) => setForm({ ...form, unit: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit..." />
                    </SelectTrigger>
                    <SelectContent>
                      {[...UNIT_OPTIONS, ...(form.unit && !UNIT_OPTIONS.includes(form.unit) ? [form.unit] : [])].map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Dosage Forms</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between font-normal">
                        {form.commonForms ? <span className="truncate">{form.commonForms}</span> : <span className="text-muted-foreground">Select forms...</span>}
                        <ChevronDown className="w-4 h-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0">
                      <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                        {formOptions.map((f) => {
                          const isChecked = formList.some((value) => sameText(value, f));
                          return (
                            <label key={f} className="flex items-center space-x-2 p-1 hover:bg-muted rounded cursor-pointer">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  setForm({
                                    ...form,
                                    commonForms: (checked
                                      ? [...formList, f]
                                      : formList.filter((value) => !sameText(value, f))
                                    ).join(", "),
                                  });
                                }}
                              />
                              <span className="flex-1 text-sm">{f}</span>
                            </label>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Common Strengths (comma separated)</Label>
                  <Input
                    value={form.commonStrengths}
                    onChange={(e) =>
                      setForm({ ...form, commonStrengths: e.target.value })
                    }
                    placeholder="e.g. 500mg, 1g"
                  />
                </div>
              </div>

              {strengthList.length * formList.length > 1 && (
                <div className="space-y-1.5">
                  <Label>Available as</Label>
                  <p className="text-xs text-muted-foreground">
                    Untick the combinations this medicine does not come in. Pharmacies can only list ticked ones.
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="text-sm" data-testid="table-available-as">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="px-3 py-1.5" aria-label="Strength" />
                          {formList.map((dosageForm) => (
                            <th key={dosageForm} scope="col" className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                              {dosageForm}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {strengthList.map((strength) => (
                          <tr key={strength} className="border-b last:border-0">
                            <th scope="row" className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                              {strength}
                            </th>
                            {formList.map((dosageForm) => {
                              const key = pairKey(strength, dosageForm);
                              return (
                                <td key={dosageForm} className="px-3 py-1.5">
                                  <Checkbox
                                    checked={!form.unavailable.includes(key)}
                                    aria-label={`${strength} ${dosageForm}`}
                                    onCheckedChange={(checked) =>
                                      setForm({
                                        ...form,
                                        unavailable: checked
                                          ? form.unavailable.filter((value) => value !== key)
                                          : [...form.unavailable, key],
                                      })
                                    }
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Tier</Label>
                  <Select
                    value={form.tier}
                    onValueChange={(v) => setForm({ ...form, tier: v })}
                  >
                    <SelectTrigger data-testid="select-drug-tier">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["1", "2", "3"] as const).map((t) => (
                        <SelectItem key={t} value={t}>
                          {TIER_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.tier === "1" && (
                  <div className="space-y-1.5">
                    <Label>Max units per order</Label>
                    <Input
                      type="number"
                      min={1}
                      required
                      value={form.maxUnits}
                      onChange={(e) =>
                        setForm({ ...form, maxUnits: e.target.value })
                      }
                      data-testid="input-max-units"
                    />
                  </div>
                )}
              </div>

              <DialogFooter className="mt-4 gap-2 sm:gap-0 pt-4 border-t">
                {isPending && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      setOpen(false);
                      setRejectDrug(editDrug);
                    }}
                  >
                    Reject Proposal
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={create.isPending || update.isPending}
                  data-testid="button-submit-drug"
                >
                  {isPending ? "Save & Approve" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
        )}

        <Dialog
          open={!!rejectDrug}
          onOpenChange={(v) => !v && setRejectDrug(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Proposal</DialogTitle>
              <DialogDescription>
                Provide a reason for rejecting this drug proposal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label>Reason</Label>
              <Input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Duplicate of existing entry, incomplete details..."
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setRejectDrug(null);
                    setOpen(true);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (!rejectReason.trim()) {
                      toast({
                        title: "Reason required",
                        variant: "destructive",
                      });
                      return;
                    }
                    update.mutate(
                      {
                        id: rejectDrug!.id,
                        data: {
                          reviewStatus: "rejected",
                          rejectionReason: rejectReason,
                        },
                      },
                      {
                        onSuccess: () => {
                          setRejectDrug(null);
                          setEditDrug(null);
                          setRejectReason("");
                        },
                      },
                    );
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={!!approvalResult} onOpenChange={(v) => !v && setApprovalResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {approvalResult?.approved ?? 0} approved, {approvalResult?.notApproved.length ?? 0} still held
            </DialogTitle>
            <DialogDescription>
              These need a change before they can be approved. Open each one with Review.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 overflow-y-auto divide-y text-sm">
            {approvalResult?.notApproved.map((item) => (
              <li key={item.id} className="py-2">
                <div className="font-medium">{item.name}</div>
                <div className="text-muted-foreground">{item.reason}</div>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setApprovalResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tab === "held" && canEdit && heldIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {selected.length
              ? `${selected.length} of ${heldIds.length} selected`
              : `${heldIds.length} waiting for approval. Check each one's tier and category before approving.`}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(selected.length === heldIds.length ? [] : heldIds)}
              data-testid="button-select-all-held"
            >
              {selected.length === heldIds.length ? "Clear selection" : "Select all"}
            </Button>
            <Button
              size="sm"
              onClick={() => void approveSelected()}
              disabled={!selected.length || approve.isPending}
              data-testid="button-approve-selected"
            >
              {approve.isPending ? "Approving…" : `Approve selected${selected.length ? ` (${selected.length})` : ""}`}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : drugs.length === 0 ? (
        <EmptyState>
          {tab === "held"
            ? "No held proposals awaiting review."
            : "No drugs in the catalogue yet."}
        </EmptyState>
      ) : (
        <div className="border rounded-xl bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {tab === "held" && canEdit && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all held medicines"
                      checked={heldIds.length > 0 && selected.length === heldIds.length}
                      onCheckedChange={(checked) => setSelected(checked ? heldIds : [])}
                    />
                  </TableHead>
                )}
                <TableHead>Drug</TableHead>
                <TableHead>Tier & Cap</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drugs.map((d) => (
                <TableRow key={d.id} data-testid={`row-drug-${d.id}`}>
                  {tab === "held" && canEdit && (
                    <TableCell>
                      {d.reviewStatus === "pending" && (
                        <Checkbox
                          aria-label={`Select ${d.name}`}
                          checked={selected.includes(d.id)}
                          onCheckedChange={(checked) =>
                            setSelected(checked ? [...selected, d.id] : selected.filter((id) => id !== d.id))
                          }
                        />
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {d.genericName && d.genericName !== d.name ? d.genericName : null}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 max-w-sm">
                      {availableAs(d)}
                    </div>
                    {d.reviewStatus === "rejected" && d.rejectionReason && (
                      <div className="text-xs text-destructive mt-1 font-medium bg-destructive/10 inline-block px-1.5 py-0.5 rounded">
                        Rejected: {d.rejectionReason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{TIER_LABEL[d.tier]}</div>
                    {d.tier === "1" && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Max {d.maxUnitsPerOrder}/order
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">
                      {categoryLabel(d.primaryCategory)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {subcategoryLabel(d.subcategory)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        d.reviewStatus === "approved"
                          ? "bg-green-100 text-green-800"
                          : d.reviewStatus === "rejected"
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-800"
                      }
                    >
                      {d.reviewStatus ||
                        (d.isApproved ? "approved" : "pending")}
                    </Badge>
                    {d.reviewStatus === "pending" &&
                      (d as any).reviewDueAt &&
                      (() => {
                        const due = parseISO((d as any).reviewDueAt);
                        return (
                          <div
                            className={`text-[11px] mt-1 ${isPast(due) ? "text-destructive font-medium" : "text-muted-foreground"}`}
                          >
                            Due {format(due, "MMM d")}
                          </div>
                        );
                      })()}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditDrug(d)}
                        data-testid={`button-edit-${d.id}`}
                      >
                        {d.reviewStatus === "pending" ? "Review" : "Edit"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleDelete(d)}
                        disabled={deleteDrug.isPending}
                        data-testid={`button-delete-${d.id}`}
                      >
                        <Trash2 className="w-4 h-4 mr-1.5" />
                        Delete Drug
                      </Button>
                    </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">View only</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </HqLayout>
  );
}
