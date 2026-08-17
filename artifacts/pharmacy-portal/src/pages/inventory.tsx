import { useState, useRef, useEffect } from "react";
import {
  useListInventory,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useListCatalogue,
  useAddInventoryItem,
  InventoryItem,
  DrugCatalogueItem,
} from "@workspace/api-client-react";
import { formatLeones } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Plus, Trash2, Edit2, AlertTriangle, ChevronDown, X, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

// ── Tier badge ────────────────────────────────────────────────────────────────
function TierBadge({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    "1": "bg-red-100 text-red-700 border border-red-200",
    "2": "bg-blue-100 text-blue-700 border border-blue-200",
    "3": "bg-gray-100 text-gray-600 border border-gray-200",
  };
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${styles[tier] ?? styles["3"]}`}>
      {tier}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Inventory() {
  const [search, setSearch] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const { data: inventory, isLoading } = useListInventory();
  const deleteMutation = useDeleteInventoryItem();
  const queryClient = useQueryClient();

  const filteredInventory = (inventory ?? []).filter((item) => {
    const q = search.toLowerCase();
    return (
      item.drug.name.toLowerCase().includes(q) ||
      (item.brand ?? "").toLowerCase().includes(q) ||
      (item.countryOfOrigin ?? "").toLowerCase().includes(q)
    );
  });

  const lowStockCount = (inventory ?? []).filter(
    (item) => item.stockQuantity <= (item.lowStockAlertAt ?? 10)
  ).length;

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this listing?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.setQueryData(["/api/pharmacy/inventory"], (old: InventoryItem[] | undefined) =>
        old ? old.filter((i) => i.id !== id) : old
      );
      toast.success("Listing removed");
    } catch {
      toast.error("Failed to remove listing");
    }
  };

  return (
    <div className="flex flex-col h-full gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? "Loading…" : `${inventory?.length ?? 0} listing${inventory?.length === 1 ? "" : "s"}${lowStockCount > 0 ? ` · ${lowStockCount} needing restock` : ""}`}
          </p>
        </div>
        <Button onClick={() => setIsAddModalOpen(true)} className="gap-2 shrink-0 bg-[#1A8F6E] hover:bg-[#157a5d] text-white">
          <Plus className="w-4 h-4" /> Add a listing
        </Button>
      </div>

      {/* Search */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search your inventory..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-card border rounded-lg h-10"
        />
      </div>

      {/* Low-stock banner */}
      {!isLoading && lowStockCount > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2.5 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {lowStockCount} listing{lowStockCount > 1 ? "s" : ""} at or below the reorder threshold — restock soon.
          </span>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-3">Drug</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-3">Brand / Origin</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-3">Tier</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-3 text-right">Le</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-3 text-right">Stock</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-4 w-40 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-4 w-28 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-6 w-6 bg-muted animate-pulse rounded-full" /></TableCell>
                    <TableCell><div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto" /></TableCell>
                    <TableCell><div className="h-4 w-10 bg-muted animate-pulse rounded ml-auto" /></TableCell>
                    <TableCell />
                  </TableRow>
                ))
              ) : filteredInventory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-52 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="w-8 h-8 text-muted-foreground/40" />
                      <p className="text-sm">{search ? "No listings match your search." : "No inventory yet."}</p>
                      {!search && (
                        <Button variant="link" className="text-[#1A8F6E]" onClick={() => setIsAddModalOpen(true)}>
                          Add your first listing
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredInventory.map((item) => {
                  const isLow = item.stockQuantity <= (item.lowStockAlertAt ?? 10);
                  const brandOrigin = [item.brand, item.countryOfOrigin].filter(Boolean).join(" · ");
                  return (
                    <TableRow key={item.id} className="hover:bg-muted/20 transition-colors">
                      <TableCell>
                        <div className="font-medium text-sm text-foreground">{item.drug.name}</div>
                        {item.drug.genericName && (
                          <div className="text-xs text-muted-foreground">{item.drug.genericName}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {brandOrigin || <span className="text-muted-foreground/40 italic">—</span>}
                      </TableCell>
                      <TableCell>
                        <TierBadge tier={item.drug.tier} />
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatLeones(item.priceLeones)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`text-sm font-medium ${isLow ? "text-amber-600" : ""}`}>
                          {isLow && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                          {item.stockQuantity}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setEditingItem(item)}>
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(item.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
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

      <AddListingModal open={isAddModalOpen} onOpenChange={setIsAddModalOpen} />
      {editingItem && (
        <EditListingModal item={editingItem} open onOpenChange={(open) => !open && setEditingItem(null)} />
      )}
    </div>
  );
}

// ── Add listing modal ─────────────────────────────────────────────────────────
function DrugDropdown({ catalogue, isLoading, value, onChange }: {
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
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = catalogue
    .filter((d) => d.isApproved && (d.name.toLowerCase().includes(search.toLowerCase()) || (d.genericName ?? "").toLowerCase().includes(search.toLowerCase())))
    .slice(0, 8);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between border rounded-md px-3 py-2 text-sm bg-background hover:border-[#1A8F6E] transition-colors"
      >
        <span className={value ? "text-foreground" : "text-muted-foreground"}>
          {value ? value.name : "Select a drug…"}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg">
          <div className="p-2 border-b">
            <Input
              autoFocus
              placeholder="Search catalogue…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No matches.</p>
            ) : filtered.map((drug) => (
              <button
                key={drug.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center justify-between"
                onClick={() => { onChange(drug); setOpen(false); setSearch(""); }}
              >
                <span>{drug.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{drug.unit} · T{drug.tier}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AddListingModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [selectedDrug, setSelectedDrug] = useState<DrugCatalogueItem | null>(null);
  const [brand, setBrand] = useState("");
  const [country, setCountry] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("100");
  const [lowStock, setLowStock] = useState("10");

  const { data: catalogue = [], isLoading } = useListCatalogue();
  const addMutation = useAddInventoryItem();
  const queryClient = useQueryClient();

  const resetForm = () => {
    setSelectedDrug(null);
    setBrand("");
    setCountry("");
    setPrice("");
    setQty("100");
    setLowStock("10");
  };

  const handleClose = () => { resetForm(); onOpenChange(false); };

  const handleAdd = async () => {
    if (!selectedDrug || !price) return;
    try {
      await addMutation.mutateAsync({
        data: {
          drugId: selectedDrug.id,
          brand: brand || undefined,
          countryOfOrigin: country || undefined,
          priceLeones: parseInt(price),
          stockQuantity: parseInt(qty) || 0,
          lowStockAlertAt: parseInt(lowStock) || 10,
          availableForDelivery: true,
          availableForCollection: true,
        },
      });
      toast.success("Listing added to inventory");
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/inventory"] });
      handleClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to add listing");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold">Add a listing</DialogTitle>
            <button onClick={handleClose} className="rounded-sm opacity-70 hover:opacity-100 transition-opacity">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            You list against MobiCare's master catalogue. Once saved, patients see it in search instantly. Prices are whole New Leones.
          </p>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {/* Catalogue drug */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Catalogue drug</Label>
            <DrugDropdown catalogue={catalogue} isLoading={isLoading} value={selectedDrug} onChange={setSelectedDrug} />
          </div>

          {/* Brand + Country */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Brand</Label>
              <Input placeholder="e.g. Panadol" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Country of origin</Label>
              <Input placeholder="e.g. UK" value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
          </div>

          {/* Price + Quantity + Unit */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Price (Le)</Label>
              <Input type="number" min="1" placeholder="35" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quantity</Label>
              <Input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unit</Label>
              <div className="flex items-center border rounded-md px-3 py-2 text-sm bg-muted/30 text-muted-foreground h-10">
                {selectedDrug?.unit || "—"}
              </div>
            </div>
          </div>

          {/* Low-stock alert */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Low-stock alert at</Label>
            <Input type="number" min="0" value={lowStock} onChange={(e) => setLowStock(e.target.value)} className="w-40" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-muted/20">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleAdd}
            disabled={!selectedDrug || !price || addMutation.isPending}
            className="bg-[#1A8F6E] hover:bg-[#157a5d] text-white"
          >
            {addMutation.isPending ? "Adding…" : "Add to inventory"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit listing modal ────────────────────────────────────────────────────────
function EditListingModal({ item, open, onOpenChange }: { item: InventoryItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [brand, setBrand] = useState(item.brand ?? "");
  const [country, setCountry] = useState(item.countryOfOrigin ?? "");
  const [price, setPrice] = useState(item.priceLeones.toString());
  const [stock, setStock] = useState(item.stockQuantity.toString());
  const [lowStock, setLowStock] = useState((item.lowStockAlertAt ?? 10).toString());

  const updateMutation = useUpdateInventoryItem();
  const queryClient = useQueryClient();

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        id: item.id,
        data: {
          brand: brand || undefined,
          countryOfOrigin: country || undefined,
          priceLeones: parseInt(price),
          stockQuantity: parseInt(stock) || 0,
          lowStockAlertAt: parseInt(lowStock) || 10,
        },
      });
      toast.success("Listing updated");
      queryClient.setQueryData(["/api/pharmacy/inventory"], (old: InventoryItem[] | undefined) =>
        old ? old.map((i) => i.id === item.id ? { ...i, brand, countryOfOrigin: country, priceLeones: parseInt(price), stockQuantity: parseInt(stock) || 0, lowStockAlertAt: parseInt(lowStock) || 10 } : i) : old
      );
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to update listing");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold">Edit listing</DialogTitle>
            <button onClick={() => onOpenChange(false)} className="rounded-sm opacity-70 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{item.drug.name}</p>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Brand</Label>
              <Input placeholder="e.g. Panadol" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Country of origin</Label>
              <Input placeholder="e.g. UK" value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Price (Le)</Label>
              <Input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stock</Label>
              <Input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Low-stock at</Label>
              <Input type="number" min="0" value={lowStock} onChange={(e) => setLowStock(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-muted/20">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!price || updateMutation.isPending} className="bg-[#1A8F6E] hover:bg-[#157a5d] text-white">
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
