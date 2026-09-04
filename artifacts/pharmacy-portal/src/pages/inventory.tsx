import React, { useState, useRef, useEffect } from "react";
import {
  useListInventory,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useListCatalogue,
  useAddInventoryItem,
  useProposeDrug,
  useListDrugCategories,
  InventoryItem,
  DrugCatalogueItem,
  DrugCategory,
  DrugPrimaryCategory,
  DrugSubcategory,
  getListInventoryQueryKey,
  getListCatalogueQueryKey,
} from "@workspace/api-client-react";
import { formatLeones } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Search,
  Plus,
  Trash2,
  Edit2,
  AlertTriangle,
  ChevronDown,
  X,
  Package,
  Clock,
  Info,
  CheckCircle2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { differenceInDays, parseISO } from "date-fns";

const selectClass =
  "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const PACKAGING_UNITS = ["Box", "Bottle", "Vial", "Sachet", "Tablet", "Capsule", "Strip", "Tube", "Ampoule", "Syringe", "Pack", "Carton", "Jar", "Can", "Roll", "Piece"];
const DOSAGE_FORMS = ["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Infusion", "Cream", "Ointment", "Gel", "Drops", "Inhaler", "Suppository", "Powder", "Patch"];

function TierBadge({
  tier,
  ...props
}: { tier: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const styles: Record<string, string> = {
    "1": "bg-red-100 text-red-700 border border-red-200",
    "2": "bg-blue-100 text-blue-700 border border-blue-200",
    "3": "bg-gray-100 text-gray-600 border border-gray-200",
  };
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full text-xs font-bold ${styles[tier] ?? styles["3"]}`}
      {...props}
    >
      {tier}
    </span>
  );
}

function DrugDropdown({
  catalogue,
  isLoading,
  value,
  onChange,
}: {
  catalogue: DrugCatalogueItem[];
  isLoading: boolean;
  value: DrugCatalogueItem | null;
  onChange: (drug: DrugCatalogueItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = catalogue
    .filter(
      (d) =>
        d.isApproved &&
        (d.name.toLowerCase().includes(search.toLowerCase()) ||
          (d.genericName ?? "").toLowerCase().includes(search.toLowerCase())),
    );

  const displayLimit = 50;
  const isTruncated = filtered.length > displayLimit;
  const displayed = filtered.slice(0, displayLimit);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between border rounded-md px-3 py-2 text-sm bg-background hover:border-primary transition-colors h-10"
        data-testid="btn-drug-dropdown"
      >
        <span
          className={
            value ? "text-foreground font-medium" : "text-muted-foreground"
          }
        >
          {value
            ? `${value.name} ${value.genericName ? `(${value.genericName})` : ""}`
            : "Select a drug from catalogue…"}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg flex flex-col">
          <div className="p-2 border-b bg-muted/10">
            <Input
              autoFocus
              placeholder="Search catalogue by name or generic…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 text-sm"
              data-testid="input-drug-search"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Loading catalogue…
              </p>
            ) : displayed.length === 0 ? (
              <div className="py-6 px-4 text-center">
                <p className="text-sm text-muted-foreground">
                  No matches found.
                </p>
              </div>
            ) : (
              <>
                {displayed.map((drug) => (
                  <button
                    key={drug.id}
                    type="button"
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 flex items-center justify-between border-b last:border-0"
                    onClick={() => {
                      onChange(drug);
                      setOpen(false);
                      setSearch("");
                    }}
                    data-testid={`option-drug-${drug.id}`}
                  >
                    <div>
                      <div className="font-medium text-foreground">
                        {drug.name}
                      </div>
                      {drug.genericName && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {drug.genericName}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider bg-muted px-1.5 py-0.5 rounded ml-2 shrink-0 text-muted-foreground border">
                      T{drug.tier}
                    </span>
                  </button>
                ))}
                {isTruncated && (
                  <div className="py-3 px-4 text-center border-t bg-muted/5">
                    <p className="text-xs text-muted-foreground">
                      Showing first {displayLimit} results. Please type to refine your search.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RequestMissingDrugModal({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: DrugCategory[];
}) {
  const proposeMutation = useProposeDrug();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [genericName, setGenericName] = useState("");
  const [strength, setStrength] = useState("");
  const [form, setForm] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState<DrugPrimaryCategory | "">("");
  const [subcategory, setSubcategory] = useState<DrugSubcategory | "">("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Name is required";
    if (!genericName.trim()) newErrors.genericName = "Generic name is required";
    if (!strength.trim()) newErrors.strength = "Strength is required";
    if (!form.trim()) newErrors.form = "Form is required";
    if (!category) newErrors.category = "Category is required";
    if (!subcategory) newErrors.subcategory = "Subcategory is required";
    if (subcategory === "other" && !description.trim())
      newErrors.description = "Explain the Other category for HQ review";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    try {
      await proposeMutation.mutateAsync({
        data: {
          name,
          genericName,
          strength,
          form,
          suggestedCategory: category as DrugPrimaryCategory,
          suggestedSubcategory:
            subcategory as DrugSubcategory,
          unit: unit || undefined,
          description: description || undefined,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListCatalogueQueryKey() });
      toast.success("Drug request submitted. HQ will review it shortly.");
      onOpenChange(false);
      setName("");
      setGenericName("");
      setStrength("");
      setForm("");
      setUnit("");
      setCategory("");
      setSubcategory("");
      setDescription("");
    } catch (e: any) {
      toast.error(e.message || "Failed to submit request");
    }
  };

  const selectedCategoryObj = categories.find((c) => c.value === category);
  const subcatOptions = selectedCategoryObj?.subcategories || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] p-0 overflow-hidden flex flex-col gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0 bg-muted/10">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold text-foreground">
              Request Missing Medicine
            </DialogTitle>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Submit a medicine to be added to the master catalogue.
          </p>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
          <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded-lg text-sm flex gap-2.5">
            <Info className="w-5 h-5 shrink-0 text-blue-600 mt-0.5" />
            <p>
              HQ reviews missing drug requests typically within one business
              day. You'll be able to add it to your inventory once approved.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Brand Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Panadol"
                data-testid="input-propose-name"
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>
                Generic Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                placeholder="e.g. Paracetamol"
                data-testid="input-propose-generic"
              />
              {errors.genericName && (
                <p className="text-xs text-destructive">{errors.genericName}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>
                Strength <span className="text-destructive">*</span>
              </Label>
              <Input
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="e.g. 500mg"
                data-testid="input-propose-strength"
              />
              {errors.strength && (
                <p className="text-xs text-destructive">{errors.strength}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>
                Form <span className="text-destructive">*</span>
              </Label>
              <select
                value={form}
                onChange={(e) => setForm(e.target.value)}
                className={selectClass}
                data-testid="select-propose-form"
              >
                <option value="">Select form...</option>
                {DOSAGE_FORMS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              {errors.form && (
                <p className="text-xs text-destructive">{errors.form}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className={selectClass}
                data-testid="select-propose-unit"
              >
                <option value="">Select unit...</option>
                {PACKAGING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Suggested Category <span className="text-destructive">*</span>
              </Label>
              <select
                value={category}
                onChange={(e) => {
                  const next = e.target.value as DrugPrimaryCategory | "";
                  setCategory(next);
                   setSubcategory("");
                }}
                className={selectClass}
                data-testid="select-propose-category"
              >
                <option value="">Select category...</option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p className="text-xs text-destructive">{errors.category}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>
                Suggested Subcategory{" "}
                <span className="text-destructive">*</span>
              </Label>
              <select
                value={subcategory}
                onChange={(e) =>
                  setSubcategory(e.target.value as DrugSubcategory | "")
                }
                className={selectClass}
                disabled={!category}
                data-testid="select-propose-subcategory"
              >
                <option value="">Select subcategory...</option>
                {subcatOptions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {errors.subcategory && (
                <p className="text-xs text-destructive">{errors.subcategory}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Additional Description / Justification</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any helpful details..."
              data-testid="input-propose-desc"
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description}</p>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-muted/10 shrink-0 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="btn-propose-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={proposeMutation.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid="btn-propose-submit"
          >
            {proposeMutation.isPending ? "Submitting…" : "Submit Request"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ListingModal({
  item,
  open,
  onOpenChange,
  catalogue,
  categories,
  inventory,
  onRequestMissing,
}: {
  item?: InventoryItem;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  catalogue: DrugCatalogueItem[];
  categories: DrugCategory[];
  inventory: InventoryItem[];
  onRequestMissing: () => void;
}) {
  const isEdit = !!item;
  const queryClient = useQueryClient();
  const addMutation = useAddInventoryItem();
  const updateMutation = useUpdateInventoryItem();

  const [selectedDrug, setSelectedDrug] = useState<DrugCatalogueItem | null>(
    null,
  );

  const [strength, setStrength] = useState("");
  const [form, setForm] = useState("");
  const [unitOfSale, setUnitOfSale] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [brand, setBrand] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [countryOfOrigin, setCountryOfOrigin] = useState("");
  const [primaryCategory, setPrimaryCategory] = useState<
    DrugPrimaryCategory | ""
  >("");
  const [subcategory, setSubcategory] = useState<DrugSubcategory | "">("");
  const [otherCategoryText, setOtherCategoryText] = useState("");
  const [priceLeones, setPriceLeones] = useState("");
  const [stockQuantity, setStockQuantity] = useState("0");
  const [lowStockAlertAt, setLowStockAlertAt] = useState("10");
  const [availableForDelivery, setAvailableForDelivery] = useState(true);
  const [availableForCollection, setAvailableForCollection] = useState(true);
  const [isActive, setIsActive] = useState(true);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (open) {
      if (item) {
        setStrength(item.strength || "");
        setForm(item.form || "");
        setUnitOfSale(item.unitOfSale || "");
        setExpiryDate(item.expiryDate ? item.expiryDate.split("T")[0] : "");
        setBrand(item.brand || "");
        setManufacturer(item.manufacturer || "");
        setCountryOfOrigin(item.countryOfOrigin || "");
        setPrimaryCategory(item.primaryCategory || "");
        setSubcategory(item.subcategory || "");
        setOtherCategoryText(item.otherCategoryText || "");
        setPriceLeones(item.priceLeones.toString());
        setStockQuantity(item.stockQuantity.toString());
        setLowStockAlertAt((item.lowStockAlertAt ?? 10).toString());
        setAvailableForDelivery(item.availableForDelivery ?? true);
        setAvailableForCollection(item.availableForCollection ?? true);
        setIsActive(item.isActive ?? true);
      } else {
        setSelectedDrug(null);
        setStrength("");
        setForm("");
        setUnitOfSale("");
        setExpiryDate("");
        setBrand("");
        setManufacturer("");
        setCountryOfOrigin("");
        setPrimaryCategory("");
        setSubcategory("");
        setOtherCategoryText("");
        setPriceLeones("");
        setStockQuantity("0");
        setLowStockAlertAt("10");
        setAvailableForDelivery(true);
        setAvailableForCollection(true);
        setIsActive(true);
      }
      setErrors({});
      setSaveError("");
    }
  }, [open, item]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!isEdit && !selectedDrug)
      newErrors.drugId = "Drug selection is required";
    if (!strength.trim()) newErrors.strength = "Strength is required";
    if (!form.trim()) newErrors.form = "Form is required";
    if (!unitOfSale.trim()) newErrors.unitOfSale = "Unit of sale is required";
    if (!expiryDate) newErrors.expiryDate = "Expiry date is required";

    const priceNum = parseFloat(priceLeones);
    if (isNaN(priceNum) || priceNum <= 0)
      newErrors.priceLeones = "Valid price is required";

    const stockNum = parseInt(stockQuantity, 10);
    if (isNaN(stockNum) || stockNum < 0)
      newErrors.stockQuantity = "Valid stock is required";

    if (subcategory === "other" && !otherCategoryText.trim()) {
      newErrors.otherCategoryText =
        "Explanation is required for 'Other' category";
    }

    const currentDrugId = isEdit ? item!.drugId : selectedDrug?.id;
    const existing = inventory.find(
      (i) =>
        i.drugId === currentDrugId &&
        i.strength === strength.trim() &&
        i.form === form.trim() &&
        i.unitOfSale === unitOfSale.trim() &&
        i.id !== item?.id,
    );

    if (existing) {
      newErrors.duplicate =
        "You already have this drug, strength, form, and unit of sale. Edit the existing listing instead.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    setSaveError("");
    if (!validate()) return;

    try {
      const payloadBase = {
        strength: strength.trim(),
        form: form.trim(),
        unitOfSale: unitOfSale.trim(),
        expiryDate,
        brand: brand.trim() || undefined,
        manufacturer: manufacturer.trim() || undefined,
        countryOfOrigin: countryOfOrigin.trim() || undefined,
        primaryCategory: (primaryCategory as DrugPrimaryCategory) || undefined,
        subcategory: (subcategory as DrugSubcategory) || undefined,
        otherCategoryText: otherCategoryText.trim() || undefined,
        priceLeones: parseFloat(priceLeones),
        stockQuantity: parseInt(stockQuantity, 10),
        lowStockAlertAt: parseInt(lowStockAlertAt, 10) || 0,
        availableForDelivery,
        availableForCollection,
      };

      if (isEdit) {
        const updated = await updateMutation.mutateAsync({
          id: item!.id,
          data: {
            ...payloadBase,
            brand: payloadBase.brand || null,
            manufacturer: payloadBase.manufacturer || null,
            countryOfOrigin: payloadBase.countryOfOrigin || null,
            primaryCategory: payloadBase.primaryCategory || null,
            subcategory: payloadBase.subcategory || null,
            otherCategoryText: payloadBase.otherCategoryText || null,
            isActive,
          },
        });

        queryClient.setQueryData(
          getListInventoryQueryKey(),
          (old: InventoryItem[] | undefined) =>
            old ? old.map((i) => (i.id === updated.id ? updated : i)) : old,
        );
        toast.success("Listing updated successfully");
      } else {
        const added = await addMutation.mutateAsync({
          data: {
            ...payloadBase,
            drugId: selectedDrug!.id,
          },
        });

        queryClient.setQueryData(
          getListInventoryQueryKey(),
          (old: InventoryItem[] | undefined) =>
            old ? [added, ...old] : [added],
        );
        toast.success("Listing added successfully");
      }
      onOpenChange(false);
    } catch (e: any) {
      const message = e.message || "Failed to save listing";
      setSaveError(message);
      toast.error(message);
    }
  };

  const commonStrengths = isEdit
    ? item!.drug.commonStrengths || []
    : selectedDrug?.commonStrengths || [];
  const commonForms = isEdit
    ? item!.drug.commonForms || []
    : selectedDrug?.commonForms || [];

  const selectedCategoryObj = categories.find(
    (c) => c.value === primaryCategory,
  );
  const subcatOptions = selectedCategoryObj?.subcategories || [];

  const isPending = addMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] p-0 overflow-hidden flex flex-col gap-0">
        <DialogHeader className="px-6 py-5 border-b shrink-0 bg-muted/10">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold text-foreground">
              {isEdit ? "Edit Pharmacy Listing" : "Add Pharmacy Listing"}
            </DialogTitle>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {!isEdit && (
            <p className="text-sm text-muted-foreground mt-1">
              List your stock against MobiCare's master catalogue. Once saved,
              patients see it instantly.
            </p>
          )}
        </DialogHeader>

        <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1">
          {saveError && (
            <div
              className="flex gap-2 items-start bg-red-50 text-red-800 p-3 rounded-lg border border-red-200"
              role="alert"
              data-testid="error-save-listing"
            >
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Listing could not be saved</p>
                <p className="text-sm mt-0.5">{saveError}</p>
              </div>
            </div>
          )}

          {errors.duplicate && (
            <div
              className="flex gap-2 items-start bg-red-50 text-red-800 p-3 rounded-lg border border-red-200"
              data-testid="error-duplicate"
            >
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{errors.duplicate}</p>
            </div>
          )}

          {isEdit && item.completionStatus === "incomplete" && (
            <div
              className="flex gap-2 items-start bg-amber-50 text-amber-800 p-3 rounded-lg border border-amber-200"
              data-testid="banner-incomplete"
            >
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
              <div>
                <p className="text-sm font-bold uppercase tracking-wide">
                  Incomplete Profile
                </p>
                <p className="text-sm mt-0.5">
                  This legacy listing is missing required details. Please fill
                  out the form completely to reactivate it in the store.
                </p>
              </div>
            </div>
          )}

          {/* Section: Core Identity */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider border-b pb-1">
              Core Identity
            </h3>

            {isEdit ? (
              <div className="space-y-1.5">
                <Label>Catalogue Drug</Label>
                <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted/30 px-3 py-2 text-sm font-medium text-foreground">
                  {item.drug.name}{" "}
                  {item.drug.genericName ? (
                    <span className="text-muted-foreground font-normal ml-1">
                      ({item.drug.genericName})
                    </span>
                  ) : (
                    ""
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex justify-between items-end mb-1">
                  <Label>
                    Catalogue Drug <span className="text-destructive">*</span>
                  </Label>
                  <button
                    type="button"
                    onClick={onRequestMissing}
                    className="text-xs text-primary hover:underline font-medium"
                    data-testid="btn-request-missing"
                  >
                    Medicine missing? Request it
                  </button>
                </div>
                <DrugDropdown
                  catalogue={catalogue}
                  isLoading={false}
                  value={selectedDrug}
                  onChange={setSelectedDrug}
                />
                {errors.drugId && (
                  <p className="text-xs text-destructive">{errors.drugId}</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  Strength <span className="text-destructive">*</span>
                </Label>
                <Input
                  list="strengths-list"
                  value={strength}
                  onChange={(e) => setStrength(e.target.value)}
                  placeholder="e.g. 500mg"
                  data-testid="input-strength"
                />
                <datalist id="strengths-list">
                  {commonStrengths.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                {errors.strength && (
                  <p className="text-xs text-destructive">{errors.strength}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>
                  Form <span className="text-destructive">*</span>
                </Label>
                <select
                  value={form}
                  onChange={(e) => setForm(e.target.value)}
                  className={selectClass}
                  data-testid="select-form"
                >
                  <option value="">Select form...</option>
                  {DOSAGE_FORMS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                  {form && !DOSAGE_FORMS.includes(form) && (
                    <option value={form}>{form} (Legacy)</option>
                  )}
                </select>
                {errors.form && (
                  <p className="text-xs text-destructive">{errors.form}</p>
                )}
              </div>
            </div>
          </div>

          {/* Section: Sales & Stock */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider border-b pb-1">
              Sales & Stock
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>
                  Unit of Sale <span className="text-destructive">*</span>
                </Label>
                <select
                  value={unitOfSale}
                  onChange={(e) => setUnitOfSale(e.target.value)}
                  className={selectClass}
                  data-testid="select-unit"
                >
                  <option value="">Select unit...</option>
                  {PACKAGING_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                  {unitOfSale && !PACKAGING_UNITS.includes(unitOfSale) && (
                    <option value={unitOfSale}>{unitOfSale} (Legacy)</option>
                  )}
                </select>
                {errors.unitOfSale && (
                  <p className="text-xs text-destructive">
                    {errors.unitOfSale}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>
                  Price (Le) <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={priceLeones}
                  onChange={(e) => setPriceLeones(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-price"
                />
                {errors.priceLeones && (
                  <p className="text-xs text-destructive">
                    {errors.priceLeones}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>
                  Stock Qty <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={stockQuantity}
                  onChange={(e) => setStockQuantity(e.target.value)}
                  data-testid="input-stock"
                />
                {errors.stockQuantity && (
                  <p className="text-xs text-destructive">
                    {errors.stockQuantity}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  Expiry Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  data-testid="input-expiry"
                />
                {errors.expiryDate && (
                  <p className="text-xs text-destructive">
                    {errors.expiryDate}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Low Stock Alert At</Label>
                <Input
                  type="number"
                  min="0"
                  value={lowStockAlertAt}
                  onChange={(e) => setLowStockAlertAt(e.target.value)}
                  data-testid="input-low-stock"
                />
              </div>
            </div>
          </div>

          {/* Section: Origin & Classification */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider border-b pb-1">
              Origin & Classification (Optional)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Brand</Label>
                <Input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="e.g. Panadol"
                  data-testid="input-brand"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Manufacturer</Label>
                <Input
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  placeholder="e.g. GSK"
                  data-testid="input-manufacturer"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Input
                  value={countryOfOrigin}
                  onChange={(e) => setCountryOfOrigin(e.target.value)}
                  placeholder="e.g. UK"
                  data-testid="input-country"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Primary Category</Label>
                <select
                  value={primaryCategory}
                  onChange={(e) => {
                    setPrimaryCategory(
                      e.target.value as DrugPrimaryCategory | "",
                    );
                    setSubcategory("");
                  }}
                  className={selectClass}
                  data-testid="select-primary-category"
                >
                  <option value="">Select category...</option>
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Subcategory</Label>
                <select
                  value={subcategory}
                  onChange={(e) =>
                    setSubcategory(e.target.value as DrugSubcategory | "")
                  }
                  className={selectClass}
                  disabled={!primaryCategory}
                  data-testid="select-subcategory"
                >
                  <option value="">Select subcategory...</option>
                  {subcatOptions.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {subcategory === "other" && (
              <div className="space-y-1.5 bg-amber-50 p-4 rounded-lg border border-amber-200 mt-2">
                <Label className="text-amber-900">
                  Category Explanation{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={otherCategoryText}
                  onChange={(e) => setOtherCategoryText(e.target.value)}
                  placeholder="Please explain the category"
                  className="bg-white"
                  data-testid="input-other-category"
                />
                {errors.otherCategoryText && (
                  <p className="text-xs text-destructive">
                    {errors.otherCategoryText}
                  </p>
                )}
                <div className="flex gap-1.5 items-center text-xs text-amber-800 font-medium mt-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>
                    Using "Other" requires HQ review before this listing goes
                    live.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Section: Status & Availability */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider border-b pb-1">
              Status & Availability
            </h3>
            <div className="flex flex-wrap gap-x-8 gap-y-4 p-4 bg-muted/20 border rounded-lg">
              {isEdit && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="w-4 h-4 rounded text-primary border-input focus:ring-primary bg-background"
                    data-testid="check-active"
                  />
                  <span className="text-sm font-medium">Listing is Active</span>
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={availableForDelivery}
                  onChange={(e) => setAvailableForDelivery(e.target.checked)}
                  className="w-4 h-4 rounded text-primary border-input focus:ring-primary bg-background"
                  data-testid="check-delivery"
                />
                <span className="text-sm font-medium">
                  Available for Delivery
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={availableForCollection}
                  onChange={(e) => setAvailableForCollection(e.target.checked)}
                  className="w-4 h-4 rounded text-primary border-input focus:ring-primary bg-background"
                  data-testid="check-collection"
                />
                <span className="text-sm font-medium">
                  Available for Pickup
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-muted/10 shrink-0 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="btn-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid="btn-save"
          >
            {isPending
              ? "Saving…"
              : isEdit
                ? "Save Changes"
                : "Add to Inventory"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Inventory() {
  const [search, setSearch] = useState("");
  const [isListingModalOpen, setIsListingModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);

  const { data: inventory, isLoading: isLoadingInventory } = useListInventory();
  const { data: catalogue = [] } = useListCatalogue();
  const { data: categories = [] } = useListDrugCategories();

  const deleteMutation = useDeleteInventoryItem();
  const queryClient = useQueryClient();

  const myRequests = catalogue.filter((d) => d.reviewStatus === "pending" || d.reviewStatus === "rejected");

  const filteredInventory = (inventory ?? []).filter((item) => {
    const q = search.toLowerCase();
    return (
      item.drug.name.toLowerCase().includes(q) ||
      (item.drug.genericName ?? "").toLowerCase().includes(q) ||
      (item.brand ?? "").toLowerCase().includes(q) ||
      (item.manufacturer ?? "").toLowerCase().includes(q) ||
      (item.countryOfOrigin ?? "").toLowerCase().includes(q)
    );
  });

  const lowStockCount = (inventory ?? []).filter(
    (item) => item.stockQuantity <= (item.lowStockAlertAt ?? 10),
  ).length;

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this listing entirely?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.setQueryData(
        getListInventoryQueryKey(),
        (old: InventoryItem[] | undefined) =>
          old ? old.filter((i) => i.id !== id) : old,
      );
      toast.success("Listing removed");
    } catch {
      toast.error("Failed to remove listing");
    }
  };

  const handleOpenAdd = () => {
    setEditingItem(null);
    setIsListingModalOpen(true);
  };

  const handleOpenEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setIsListingModalOpen(true);
  };

  const handleRequestMissing = () => {
    setIsListingModalOpen(false);
    setIsRequestModalOpen(true);
  };

  return (
    <div className="flex flex-col h-full gap-5 max-w-[1400px] mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Inventory
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoadingInventory
              ? "Loading…"
              : `${inventory?.length ?? 0} listing${inventory?.length === 1 ? "" : "s"}${lowStockCount > 0 ? ` · ${lowStockCount} needing restock` : ""}`}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            onClick={() => setIsRequestModalOpen(true)}
            className="gap-2 shrink-0 bg-background"
            data-testid="btn-request-drug"
          >
            Request Missing Drug
          </Button>
          <Button
            onClick={handleOpenAdd}
            className="gap-2 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            data-testid="btn-add-listing"
          >
            <Plus className="w-4 h-4" /> Add Listing
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative w-full shadow-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by drug name, generic name, brand, or manufacturer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-card border rounded-lg h-11 text-base sm:text-sm"
          data-testid="input-search-inventory"
        />
      </div>

      {/* My Drug Requests */}
      {myRequests.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">My Drug Requests</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {myRequests.map((req) => (
              <div key={req.id} className="p-4 border rounded-xl bg-card shadow-sm space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-foreground">{req.name}</p>
                    {req.genericName && <p className="text-sm text-muted-foreground">{req.genericName}</p>}
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${req.reviewStatus === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                    {req.reviewStatus === 'pending' ? 'Pending Review' : 'Rejected'}
                  </span>
                </div>
                {req.reviewStatus === 'rejected' && req.rejectionReason && (
                  <div className="p-2 bg-red-50 text-red-800 rounded-md text-sm border border-red-100">
                    <p className="font-medium">Reason:</p>
                    <p>{req.rejectionReason}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low-stock banner */}
      {!isLoadingInventory && lowStockCount > 0 && (
        <div
          className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2.5 text-sm shadow-sm"
          data-testid="banner-low-stock"
        >
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
          <span>
            {lowStockCount} listing{lowStockCount > 1 ? "s" : ""} at or below
            the reorder threshold — please restock soon.
          </span>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto flex-1">
          <Table className="min-w-[900px]">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-3 w-auto">
                  Drug & Details
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-3 w-[15%]">
                  Brand / Origin
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-3 w-20">
                  Tier
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-3 text-right w-[15%]">
                  Price
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-3 text-right w-[10%]">
                  Stock
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-3 text-right w-[15%]">
                  Expiry
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-3 text-right w-[12%]">
                  Status
                </TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingInventory ? (
                Array(5)
                  .fill(0)
                  .map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="h-5 w-48 bg-muted animate-pulse rounded" />
                        <div className="h-3 w-32 bg-muted animate-pulse rounded mt-2" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-28 bg-muted animate-pulse rounded" />
                      </TableCell>
                      <TableCell>
                        <div className="h-6 w-6 bg-muted animate-pulse rounded-full" />
                      </TableCell>
                      <TableCell>
                        <div className="h-5 w-16 bg-muted animate-pulse rounded ml-auto" />
                        <div className="h-3 w-10 bg-muted animate-pulse rounded ml-auto mt-2" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-10 bg-muted animate-pulse rounded ml-auto" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-20 bg-muted animate-pulse rounded ml-auto" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto" />
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))
              ) : filteredInventory.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-64 text-center text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
                        <Package className="w-6 h-6 text-muted-foreground/60" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-medium text-foreground">
                          {search ? "No matches found" : "No inventory yet"}
                        </p>
                        <p className="text-sm">
                          {search
                            ? "Try adjusting your search terms."
                            : "Start adding medicines to your digital store."}
                        </p>
                      </div>
                      {!search && (
                        <Button
                          variant="outline"
                          className="mt-2"
                          onClick={handleOpenAdd}
                        >
                          Add your first listing
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredInventory.map((item) => {
                  const isLegacy = item.completionStatus === "incomplete";
                  const daysToExpiry = item.expiryDate
                    ? differenceInDays(parseISO(item.expiryDate), new Date())
                    : null;
                  const isExpired = daysToExpiry !== null && daysToExpiry <= 0;
                  const isNearExpiry =
                    daysToExpiry !== null &&
                    daysToExpiry > 0 &&
                    daysToExpiry <= 30;
                  const isLowStock =
                    item.stockQuantity <= (item.lowStockAlertAt ?? 10);
                  const brandOrigin = [
                    item.brand,
                    item.manufacturer,
                    item.countryOfOrigin,
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <TableRow
                      key={item.id}
                      className={`${isLegacy ? "bg-muted/30 hover:bg-muted/40" : "hover:bg-muted/20"} transition-colors`}
                      data-testid={`row-inventory-${item.id}`}
                    >
                      <TableCell>
                        <div className="font-semibold text-sm text-foreground flex flex-wrap items-center gap-2">
                          {item.drug.name}
                          {isLegacy && (
                            <span
                              className="inline-flex items-center text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border border-amber-200 bg-amber-100 text-amber-800"
                              data-testid={`badge-legacy-${item.id}`}
                            >
                              Incomplete
                            </span>
                          )}
                          {item.requiresHqReview && (
                            <span
                              className="inline-flex items-center text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border border-blue-200 bg-blue-100 text-blue-800"
                              data-testid={`badge-review-${item.id}`}
                            >
                              Review Pending
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {[item.drug.genericName, item.strength, item.form]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {brandOrigin || (
                          <span className="text-muted-foreground/40 italic">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <TierBadge
                          tier={item.drug.tier}
                          data-testid={`tier-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div
                          className="text-sm font-bold text-foreground"
                          data-testid={`price-${item.id}`}
                        >
                          {formatLeones(item.priceLeones)}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mt-0.5">
                          / {item.unitOfSale || "Unit"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div
                          className={`text-sm font-semibold ${isLowStock ? "text-amber-600" : "text-foreground"}`}
                          data-testid={`stock-${item.id}`}
                        >
                          {isLowStock && (
                            <AlertTriangle className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                          )}
                          {item.stockQuantity}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {item.expiryDate ? (
                          <div
                            className={`text-sm ${isExpired ? "text-destructive font-bold" : isNearExpiry ? "text-amber-600 font-bold" : "text-muted-foreground font-medium"}`}
                            data-testid={`expiry-${item.id}`}
                          >
                            {(isExpired || isNearExpiry) && (
                              <Clock className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                            )}
                            {parseISO(item.expiryDate).toLocaleDateString(
                              undefined,
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              },
                            )}
                            {isExpired && (
                              <div className="text-[10px] uppercase tracking-wider mt-0.5">
                                Expired
                              </div>
                            )}
                            {isNearExpiry && (
                              <div className="text-[10px] uppercase tracking-wider mt-0.5">
                                Expiring Soon
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 italic">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-end">
                          {item.isActive ? (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Active
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Inactive
                            </span>
                          )}
                          <div className="flex gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground mt-1">
                            {item.availableForDelivery && (
                              <span className="bg-muted px-1.5 py-0.5 rounded border">
                                Delivery
                              </span>
                            )}
                            {item.availableForCollection && (
                              <span className="bg-muted px-1.5 py-0.5 rounded border">
                                Pickup
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {isLegacy ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900 h-8 text-xs font-bold uppercase tracking-wide"
                              onClick={() => handleOpenEdit(item)}
                              data-testid={`btn-complete-${item.id}`}
                            >
                              Complete Setup
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => handleOpenEdit(item)}
                                data-testid={`btn-edit-${item.id}`}
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleDelete(item.id)}
                                data-testid={`btn-delete-${item.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ListingModal
        open={isListingModalOpen}
        onOpenChange={setIsListingModalOpen}
        item={editingItem || undefined}
        catalogue={catalogue}
        categories={categories}
        inventory={inventory ?? []}
        onRequestMissing={handleRequestMissing}
      />

      <RequestMissingDrugModal
        open={isRequestModalOpen}
        onOpenChange={setIsRequestModalOpen}
        categories={categories}
      />
    </div>
  );
}
