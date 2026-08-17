import { useState } from "react";
import { 
  useListInventory, 
  useUpdateInventoryItem, 
  useDeleteInventoryItem,
  useListCatalogue,
  useAddInventoryItem,
  InventoryItem,
  DrugCatalogueItem
} from "@workspace/api-client-react";
import { formatLeones } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, Trash2, Edit2, AlertTriangle, Info, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const { data: inventory, isLoading } = useListInventory();
  const updateMutation = useUpdateInventoryItem();
  const deleteMutation = useDeleteInventoryItem();
  const queryClient = useQueryClient();

  const filteredInventory = inventory?.filter(item => 
    item.drug.name.toLowerCase().includes(search.toLowerCase()) || 
    (item.drug.genericName && item.drug.genericName.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  const handleToggle = async (item: InventoryItem, field: 'availableForDelivery' | 'availableForCollection' | 'isActive', value: boolean) => {
    try {
      await updateMutation.mutateAsync({ 
        id: item.id, 
        data: { [field]: value } 
      });
      queryClient.setQueryData(["/api/pharmacy/inventory"], (old: InventoryItem[] | undefined) => {
        if (!old) return old;
        return old.map(i => i.id === item.id ? { ...i, [field]: value } : i);
      });
      toast.success("Updated successfully");
    } catch (e: any) {
      toast.error(e.message || "Failed to update");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to remove this listing?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.setQueryData(["/api/pharmacy/inventory"], (old: InventoryItem[] | undefined) => {
        if (!old) return old;
        return old.filter(i => i.id !== id);
      });
      toast.success("Listing removed");
    } catch (e: any) {
      toast.error("Failed to remove listing");
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage your available medicines and prices.</p>
        </div>
        <Button onClick={() => setIsAddModalOpen(true)} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" /> Add Listing
        </Button>
      </div>

      <div className="flex items-center bg-card p-2 rounded-lg border shadow-sm w-full sm:w-96 relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by drug name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 border-0 focus-visible:ring-0 bg-transparent h-9"
        />
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
              <TableRow>
                <TableHead>Drug Name</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-center">Delivery</TableHead>
                <TableHead className="text-center">Collection</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-5 w-32 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-5 w-16 bg-muted animate-pulse rounded-full" /></TableCell>
                    <TableCell><div className="h-5 w-20 bg-muted animate-pulse rounded ml-auto" /></TableCell>
                    <TableCell><div className="h-5 w-12 bg-muted animate-pulse rounded ml-auto" /></TableCell>
                    <TableCell><div className="h-5 w-10 mx-auto bg-muted animate-pulse rounded-full" /></TableCell>
                    <TableCell><div className="h-5 w-10 mx-auto bg-muted animate-pulse rounded-full" /></TableCell>
                    <TableCell><div className="h-5 w-10 mx-auto bg-muted animate-pulse rounded-full" /></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                ))
              ) : filteredInventory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Info className="w-8 h-8 text-muted-foreground/50" />
                      <p>No inventory listings found.</p>
                      <Button variant="link" onClick={() => setIsAddModalOpen(true)}>Add your first listing</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredInventory.map((item) => (
                  <TableRow key={item.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell>
                      <div className="font-medium text-sm">{item.drug.name}</div>
                      {item.drug.genericName && (
                        <div className="text-xs text-muted-foreground">{item.drug.genericName} • {item.drug.unit}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.drug.tier === '1' ? 'destructive' : item.drug.tier === '2' ? 'default' : 'secondary'} className="text-[10px]">
                        Tier {item.drug.tier}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-sm">
                      {formatLeones(item.priceLeones)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className={`text-sm font-medium ${item.stockQuantity <= 5 ? 'text-destructive flex items-center justify-end gap-1' : ''}`}>
                        {item.stockQuantity <= 5 && <AlertTriangle className="w-3 h-3" />}
                        {item.stockQuantity}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch 
                        checked={item.availableForDelivery} 
                        onCheckedChange={(v) => handleToggle(item, 'availableForDelivery', v)}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch 
                        checked={item.availableForCollection} 
                        onCheckedChange={(v) => handleToggle(item, 'availableForCollection', v)}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch 
                        checked={item.isActive} 
                        onCheckedChange={(v) => handleToggle(item, 'isActive', v)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setEditingItem(item)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <AddListingModal open={isAddModalOpen} onOpenChange={setIsAddModalOpen} />
      
      {editingItem && (
        <EditListingModal 
          item={editingItem} 
          open={!!editingItem} 
          onOpenChange={(open) => !open && setEditingItem(null)} 
        />
      )}
    </div>
  );
}

function AddListingModal({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const [search, setSearch] = useState("");
  const [selectedDrug, setSelectedDrug] = useState<DrugCatalogueItem | null>(null);
  
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [delivery, setDelivery] = useState(true);
  const [collection, setCollection] = useState(true);
  
  const { data: catalogue, isLoading } = useListCatalogue();
  const addMutation = useAddInventoryItem();
  const queryClient = useQueryClient();

  // Reset state when opened
  if (!open && selectedDrug) {
    setSelectedDrug(null);
    setSearch("");
    setPrice("");
    setStock("");
  }

  const filteredCatalogue = catalogue?.filter(drug => 
    drug.isApproved && 
    (drug.name.toLowerCase().includes(search.toLowerCase()) || 
     (drug.genericName && drug.genericName.toLowerCase().includes(search.toLowerCase())))
  ).slice(0, 10) || [];

  const handleAdd = async () => {
    if (!selectedDrug || !price) return;
    try {
      await addMutation.mutateAsync({
        data: {
          drugId: selectedDrug.id,
          priceLeones: parseInt(price),
          stockQuantity: parseInt(stock) || 0,
          availableForDelivery: delivery,
          availableForCollection: collection
        }
      });
      toast.success("Listing added");
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/inventory"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to add listing");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Inventory Listing</DialogTitle>
          <DialogDescription>
            Search the central catalogue for a medicine to add to your inventory.
          </DialogDescription>
        </DialogHeader>

        {!selectedDrug ? (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search drug catalogue..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <div className="border rounded-md max-h-[300px] overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground animate-pulse">Loading catalogue...</div>
              ) : filteredCatalogue.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No matches found.</div>
              ) : (
                <div className="flex flex-col divide-y">
                  {filteredCatalogue.map(drug => (
                    <button
                      key={drug.id}
                      className="p-3 text-left hover:bg-muted/50 transition-colors flex items-center justify-between group"
                      onClick={() => setSelectedDrug(drug)}
                    >
                      <div>
                        <div className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">{drug.name}</div>
                        <div className="text-xs text-muted-foreground">Tier {drug.tier} • {drug.unit}</div>
                      </div>
                      <Plus className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between bg-muted/30 p-3 rounded-lg border">
              <div>
                <div className="font-semibold text-sm">{selectedDrug.name}</div>
                <div className="text-xs text-muted-foreground">{selectedDrug.genericName} • {selectedDrug.unit}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedDrug(null)} className="h-auto py-1 px-2 text-xs">
                Change
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Price (SLL)</Label>
                <Input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 50000" />
              </div>
              <div className="space-y-2">
                <Label>Stock Quantity</Label>
                <Input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} placeholder="0" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Available for Delivery</Label>
                  <p className="text-xs text-muted-foreground">Show in delivery searches</p>
                </div>
                <Switch checked={delivery} onCheckedChange={setDelivery} />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Available for Collection</Label>
                  <p className="text-xs text-muted-foreground">Show for in-person pickup</p>
                </div>
                <Switch checked={collection} onCheckedChange={setCollection} />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!price || addMutation.isPending}>
                {addMutation.isPending ? "Adding..." : "Add to Inventory"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditListingModal({ item, open, onOpenChange }: { item: InventoryItem, open: boolean, onOpenChange: (open: boolean) => void }) {
  const [price, setPrice] = useState(item.priceLeones.toString());
  const [stock, setStock] = useState(item.stockQuantity.toString());
  
  const updateMutation = useUpdateInventoryItem();
  const queryClient = useQueryClient();

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        id: item.id,
        data: {
          priceLeones: parseInt(price),
          stockQuantity: parseInt(stock) || 0
        }
      });
      toast.success("Listing updated");
      queryClient.setQueryData(["/api/pharmacy/inventory"], (old: InventoryItem[] | undefined) => {
        if (!old) return old;
        return old.map(i => i.id === item.id ? { 
          ...i, 
          priceLeones: parseInt(price), 
          stockQuantity: parseInt(stock) || 0 
        } : i);
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to update listing");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Listing</DialogTitle>
          <DialogDescription>Update price and stock for {item.drug.name}.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Price (SLL)</Label>
            <Input 
              type="number" 
              className="col-span-3" 
              value={price} 
              onChange={(e) => setPrice(e.target.value)} 
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Stock</Label>
            <Input 
              type="number" 
              className="col-span-3" 
              value={stock} 
              onChange={(e) => setStock(e.target.value)} 
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
