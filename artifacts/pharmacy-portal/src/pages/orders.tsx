import { useState } from "react";
import { 
  useListOrders, 
  useUpdateOrderStatus, 
  useMarkOrderCollected, 
  useMarkOrderPickedUp, 
  getListOrdersQueryKey,
  getGetAnalyticsOverviewQueryKey,
  Order, 
} from "@workspace/api-client-react";
import { formatLeones, formatDateTime } from "@/lib/format";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, Clock, Package, MapPin, Search, AlertCircle, ShoppingBag, Truck, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

const STATUS_CONFIG: Record<string, { label: string, color: string, icon: any }> = {
  awaiting_payment: { label: "Awaiting Payment", color: "bg-muted text-muted-foreground", icon: Clock },
  paid: { label: "Paid - Needs Confirmation", color: "bg-accent text-accent-foreground border-accent-foreground/20 border", icon: AlertCircle },
  confirmed: { label: "Confirmed", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300", icon: CheckCircle },
  packaging: { label: "Packaging (Legacy)", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300", icon: Package },
  ready: { label: "Packaged", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border border-green-200", icon: Package },
  assigned: { label: "Courier Assigned", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300", icon: Truck },
  picked_up: { label: "Collected", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300", icon: Truck },
  delivering: { label: "Delivering", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300", icon: Truck },
  delivered: { label: "Delivered", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300", icon: Check },
  collected: { label: "Collected", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300", icon: Check },
  cancelled: { label: "Cancelled", color: "bg-destructive/10 text-destructive", icon: AlertCircle },
};

const DELIVERY_STAGES = [
  { label: "Confirmed", statuses: ["confirmed", "packaging", "ready", "assigned", "picked_up", "delivering", "delivered"] },
  { label: "Packaged", statuses: ["ready", "assigned", "picked_up", "delivering", "delivered"] },
  { label: "Collected", statuses: ["picked_up", "delivering", "delivered"] },
] as const;

function statusConfigFor(order: Order) {
  if (order.status === "collected" && order.fulfillmentType === "collection") {
    return { label: "Patient Handover Complete", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300", icon: Check };
  }
  return STATUS_CONFIG[order.status] || { label: order.status, color: "bg-muted", icon: Clock };
}

export default function Orders() {
  const [location] = useLocation();
  const [activeTab, setActiveTab] = useState(() =>
    new URLSearchParams(location.split("?")[1]).get("tab") === "cancelled"
      ? "cancelled"
      : "active"
  );
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const { data: orders, isLoading } = useListOrders(undefined, {
    query: { queryKey: getListOrdersQueryKey(), refetchInterval: 5_000 },
  });

  const filteredOrders = orders?.filter(order => {
    // Search filter
    if (search && !order.id.toLowerCase().includes(search.toLowerCase()) && 
        !order.patientName.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    // Tab filter
    if (activeTab === "active") {
      return !['delivered', 'collected', 'cancelled'].includes(order.status);
    }
    if (activeTab === "completed") {
      return ['delivered', 'collected'].includes(order.status);
    }
    if (activeTab === "cancelled") {
      return order.status === 'cancelled';
    }
    return true; // "all"
  }) || [];

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage fulfillment for patient orders.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-card p-2 rounded-lg border shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="active">Active Work</TabsTrigger>
            <TabsTrigger value="all">All Orders</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search ID or patient..."
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
                <TableHead>Order ID</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fulfillment</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-5 w-20 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-5 w-24 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-5 w-32 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-6 w-24 bg-muted animate-pulse rounded-full" /></TableCell>
                    <TableCell><div className="h-5 w-20 bg-muted animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-5 w-16 bg-muted animate-pulse rounded ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                    No orders found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((order) => {
                  const statusInfo = statusConfigFor(order);
                  return (
                    <TableRow 
                      key={order.id} 
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <TableCell className="font-mono text-xs">{order.id.slice(0,8).toUpperCase()}</TableCell>
                      <TableCell className="text-sm">{formatDateTime(order.createdAt)}</TableCell>
                      <TableCell className="font-medium text-sm">{order.patientName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${statusInfo.color} font-medium border-0`}>
                          {statusInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm capitalize text-muted-foreground flex items-center gap-1.5">
                        {order.fulfillmentType === 'delivery' ? <MapPin className="w-3.5 h-3.5" /> : <ShoppingBag className="w-3.5 h-3.5" />}
                        {order.fulfillmentType}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatLeones(order.totalLeones)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <OrderDetailsSheet 
        order={selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
        onOrderUpdated={setSelectedOrder}
      />
    </div>
  );
}

function OrderDetailsSheet({
  order,
  onClose,
  onOrderUpdated,
}: {
  order: Order | null;
  onClose: () => void;
  onOrderUpdated: (order: Order) => void;
}) {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateOrderStatus();
  const markCollected = useMarkOrderCollected();
  const markPickedUp = useMarkOrderPickedUp();
  
  if (!order) return <Sheet open={false} onOpenChange={onClose}><SheetContent /></Sheet>;

  const statusInfo = statusConfigFor(order);
  const mergeUpdatedOrder = (updated: Order): Order => ({
    ...order,
    ...updated,
    // Pharmacy status endpoints return the order record without its nested
    // items. Preserve the open panel's details while applying the new status.
    items: updated.items ?? order.items,
  });

  const handleStatusUpdate = async (newStatus: "confirmed" | "ready") => {
    try {
      const updated = await updateStatus.mutateAsync({ id: order.id, data: { status: newStatus } });
      onOrderUpdated(mergeUpdatedOrder(updated));
      toast.success(newStatus === "ready" ? "Order marked as packaged" : "Order confirmed");
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/orders"] });
      queryClient.invalidateQueries({ queryKey: getGetAnalyticsOverviewQueryKey() });
    } catch (e: any) {
      toast.error(e.message || "Failed to update order");
    }
  };

  const handleCollected = async () => {
    try {
      const updated = await markCollected.mutateAsync({ id: order.id, data: { idChecked: true } });
      onOrderUpdated(mergeUpdatedOrder(updated));
      toast.success("Patient handover completed");
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/orders"] });
      queryClient.invalidateQueries({ queryKey: getGetAnalyticsOverviewQueryKey() });
    } catch (e: any) {
      toast.error(e.message || "Failed to complete order");
    }
  };

  const handlePickedUp = async () => {
    try {
      const updated = await markPickedUp.mutateAsync({ id: order.id });
      onOrderUpdated(mergeUpdatedOrder(updated));
      toast.success("Order marked as collected by courier");
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/orders"] });
      queryClient.invalidateQueries({ queryKey: getGetAnalyticsOverviewQueryKey() });
    } catch (e: any) {
      toast.error(e.message || "Failed to complete order");
    }
  };

  return (
    <Sheet open={!!order} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full max-w-full sm:w-[540px] overflow-y-auto bg-card border-l flex flex-col p-0">
        <div className="p-6 border-b bg-muted/20">
          <SheetHeader>
            <div className="flex items-center justify-between mb-2">
              <SheetTitle className="font-mono text-sm tracking-tight text-muted-foreground flex items-center gap-2">
                ORDER #{order.id.slice(0, 8).toUpperCase()}
              </SheetTitle>
              <Badge variant="outline" className={`${statusInfo.color} font-medium border-0`}>
                {statusInfo.label}
              </Badge>
            </div>
            <SheetDescription className="text-base text-foreground font-medium">
              {formatDateTime(order.createdAt)}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="p-6 flex-1 space-y-8">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Customer Info</h3>
            <div className="bg-muted/30 rounded-lg p-4 space-y-2 border">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm font-medium">{order.patientName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Phone</span>
                <span className="text-sm font-medium">{order.patientPhone}</span>
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t">
                <span className="text-sm text-muted-foreground">Fulfillment</span>
                <span className="text-sm font-medium capitalize flex items-center gap-1">
                  {order.fulfillmentType === 'delivery' ? <MapPin className="w-3.5 h-3.5" /> : <ShoppingBag className="w-3.5 h-3.5" />}
                  {order.fulfillmentType}
                </span>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Order Items ({order.items.length})</h3>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 py-2 text-xs">Item</TableHead>
                    <TableHead className="h-8 py-2 text-xs text-right">Qty</TableHead>
                    <TableHead className="h-8 py-2 text-xs text-right">Base</TableHead>
                    <TableHead className="h-8 py-2 text-xs text-right">Service fee</TableHead>
                    <TableHead className="h-8 py-2 text-xs text-right">Patient price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map(item => {
                    const baseLineTotalMinor =
                      (item.baseUnitPriceMinor ?? 0) * item.quantity;
                    const patientLineTotalMinor =
                      item.patientLineTotalMinor ??
                      (item.patientUnitPriceMinor ?? 0) * item.quantity;
                    return (
                      <TableRow key={item.id} className="hover:bg-transparent">
                        <TableCell className="py-2 text-sm">{item.drugName}</TableCell>
                        <TableCell className="py-2 text-sm text-right">x{item.quantity}</TableCell>
                        <TableCell className="py-2 text-sm text-right">{formatLeones(baseLineTotalMinor / 100)}</TableCell>
                        <TableCell className="py-2 text-sm text-right">{formatLeones((patientLineTotalMinor - baseLineTotalMinor) / 100)}</TableCell>
                        <TableCell className="py-2 text-sm text-right font-medium">{formatLeones(patientLineTotalMinor / 100)}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/10 hover:bg-muted/10">
                    <TableCell colSpan={3} className="py-3 font-semibold">Patient medicine total</TableCell>
                    <TableCell className="py-3 text-right font-bold text-primary">
                      {formatLeones((order.patientMedicineTotalMinor ?? 0) / 100)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/10 hover:bg-muted/10">
                    <TableCell colSpan={3} className="py-2 font-medium">Pharmacy earnings</TableCell>
                    <TableCell className="py-2 text-right font-semibold">{formatLeones((order.pharmacyMedicineTotalMinor ?? 0) / 100)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Pharmacy Stages</h3>
                 <p className="text-xs text-muted-foreground mt-1">
                {order.fulfillmentType === "delivery"
                   ? "After a courier is assigned, mark the packaged order as collected so HQ can start delivery."
                  : "In-person patient handover is tracked separately from courier collection."}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DELIVERY_STAGES.map((stage, index) => {
                const complete = stage.statuses.includes(order.status as never);
                const unavailable = order.fulfillmentType === "collection" && index === 2;
                return (
                  <div
                    key={stage.label}
                    className={`rounded-lg border px-3 py-3 text-center ${
                      complete && !unavailable
                        ? "border-primary/30 bg-primary/5 text-primary"
                        : "bg-muted/20 text-muted-foreground"
                    }`}
                  >
                    <div className="flex justify-center mb-1">
                      {complete && !unavailable ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                    </div>
                    <div className="text-xs font-semibold">{unavailable ? "In-Person" : stage.label}</div>
                  </div>
                );
              })}
            </div>

            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Next Action</h3>
            <div className="flex flex-col gap-2 p-4 bg-muted/20 border rounded-lg">
              {order.status === "paid" && (
                <Button onClick={() => handleStatusUpdate("confirmed")} className="w-full">
                  Confirm Order
                </Button>
              )}
              {(order.status === "confirmed" || order.status === "packaging") && (
                <Button onClick={() => handleStatusUpdate("ready")} className="w-full">
                  Mark as Packaged
                </Button>
              )}
              {order.status === "ready" && order.fulfillmentType === "collection" && (
                <Button onClick={handleCollected} className="w-full">
                  Complete Patient Handover (ID Checked)
                </Button>
              )}
              {order.status === "ready" && order.fulfillmentType === "delivery" && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Packaged. Waiting for HQ to assign a courier.
                </p>
              )}
              {order.status === "assigned" && order.fulfillmentType === "delivery" && (
                <Button onClick={handlePickedUp} className="w-full">
                   Mark as Collected
                </Button>
              )}
              
              {["awaiting_payment", "picked_up", "delivering", "delivered", "collected", "cancelled"].includes(order.status) && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No actions available for current status.
                </p>
              )}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
