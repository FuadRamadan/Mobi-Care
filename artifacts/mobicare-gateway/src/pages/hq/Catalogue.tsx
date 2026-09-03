import { useState, useEffect } from "react";
import {
  useListHqDrugs,
  useCreateHqDrug,
  useUpdateHqDrug,
  useDeleteHqDrug,
  useListDrugCategories,
  getListHqDrugsQueryKey,
  type HqDrug,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import HqLayout from "./HqLayout";
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

const CATEGORY_LABELS: Record<string, string> = {
  pain_fever: "Pain & Fever",
  infection: "Infection",
  malaria: "Malaria",
  respiratory_allergy: "Respiratory & Allergy",
  digestive: "Digestive",
  cardiovascular: "Cardiovascular",
  diabetes_endocrine: "Diabetes & Endocrine",
  womens_reproductive: "Women's & Reproductive",
  child_health: "Child Health",
  mental_neurological: "Mental & Neurological",
  skin_wound: "Skin & Wound",
  eye_ear: "Eye & Ear",
  vitamins_nutrition: "Vitamins & Nutrition",
  other: "Other",
};

const SUBCATEGORY_LABELS: Record<string, string> = {
  analgesics_antipyretics: "Analgesics & Antipyretics",
  anti_inflammatory: "Anti-inflammatory",
  antibiotics: "Antibiotics",
  antifungal_antiparasitic: "Antifungal & Antiparasitic",
  antimalarials: "Antimalarials",
  cough_cold: "Cough & Cold",
  allergy: "Allergy",
  gastrointestinal: "Gastrointestinal",
  oral_rehydration: "Oral Rehydration",
  hypertension: "Hypertension",
  heart_health: "Heart Health",
  diabetes: "Diabetes",
  reproductive_health: "Reproductive Health",
  maternal_health: "Maternal Health",
  pediatric: "Pediatric",
  neurological: "Neurological",
  mental_health: "Mental Health",
  dermatology: "Dermatology",
  wound_care: "Wound Care",
  eye_care: "Eye Care",
  ear_care: "Ear Care",
  vitamins_minerals: "Vitamins & Minerals",
  other: "Other",
};

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
};

export default function HqCatalogue() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
  const { data: categories = [] } = useListDrugCategories();
  const drugs = data ?? [];

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListHqDrugsQueryKey() });
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

    const payload = {
      name: form.name,
      genericName: form.genericName || undefined,
      tier: form.tier as "1" | "2" | "3",
      unit: form.unit || undefined,
      maxUnitsPerOrder: form.maxUnits ? Number(form.maxUnits) : null,
      primaryCategory: form.primaryCategory as any,
      subcategory: form.subcategory as any,
      commonStrengths: form.commonStrengths
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      commonForms: form.commonForms
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    if (isNew) {
      create.mutate({ data: payload }, { onSuccess: () => setOpen(false) });
    } else {
      const updateData: any = {
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
                  <Label>Common Strengths (comma separated)</Label>
                  <Input
                    value={form.commonStrengths}
                    onChange={(e) =>
                      setForm({ ...form, commonStrengths: e.target.value })
                    }
                    placeholder="e.g. 500mg, 1g"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Common Forms (comma separated)</Label>
                  <Input
                    value={form.commonForms}
                    onChange={(e) =>
                      setForm({ ...form, commonForms: e.target.value })
                    }
                    placeholder="e.g. Tablet, Syrup"
                  />
                </div>
              </div>

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
                  <TableCell>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {d.genericName ?? "—"}
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
                      {d.primaryCategory
                        ? CATEGORY_LABELS[d.primaryCategory as string]
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {d.subcategory
                        ? SUBCATEGORY_LABELS[d.subcategory as string]
                        : "—"}
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
