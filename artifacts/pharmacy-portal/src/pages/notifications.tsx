import { useListNotifications, useMarkNotificationsRead, getListNotificationsQueryKey } from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Check, CheckCircle2, Circle, Bell, Activity, Package, FileText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import clsx from "clsx";

export default function Notifications() {
  const { data: notifications, isLoading } = useListNotifications({ query: { refetchInterval: 60000, queryKey: getListNotificationsQueryKey() } });
  const markRead = useMarkNotificationsRead();
  const queryClient = useQueryClient();

  const handleMarkAllRead = async () => {
    try {
      await markRead.mutateAsync({ data: {} }); // empty data marks all
      toast.success("All notifications marked as read");
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/notifications/unread-count"] });
    } catch (e: any) {
      toast.error("Failed to mark notifications");
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await markRead.mutateAsync({ data: { ids: [id] } });
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/notifications/unread-count"] });
    } catch (e: any) {
      // ignore
    }
  };

  const hasUnread = notifications?.some(n => !n.readAt);

  return (
    <div className="max-w-4xl mx-auto space-y-6 flex flex-col h-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1 text-sm">Updates on orders, prescriptions, and system alerts.</p>
        </div>
        {hasUnread && (
          <Button variant="outline" size="sm" onClick={handleMarkAllRead} disabled={markRead.isPending}>
            <Check className="w-4 h-4 mr-2" /> Mark all as read
          </Button>
        )}
      </div>

      <div className="bg-card border rounded-xl shadow-sm flex-1 overflow-hidden flex flex-col">
        <div className="overflow-y-auto flex-1 p-0">
          {isLoading ? (
            <div className="divide-y">
              {Array(5).fill(0).map((_, i) => (
                <div key={i} className="p-4 flex gap-4 animate-pulse">
                  <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-muted rounded w-1/4" />
                    <div className="h-3 bg-muted rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : !notifications || notifications.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
              <Bell className="w-8 h-8 text-muted-foreground/50 mb-2" />
              <p>You have no notifications.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map(notification => {
                const isUnread = !notification.readAt;
                
                let Icon = Bell;
                if (notification.type === 'order') Icon = Package;
                if (notification.type === 'prescription') Icon = FileText;
                if (notification.type === 'system') Icon = Activity;

                return (
                  <div 
                    key={notification.id} 
                    className={clsx(
                      "p-4 flex gap-4 transition-colors relative group",
                      isUnread ? "bg-primary/5" : "hover:bg-muted/30"
                    )}
                  >
                    {isUnread && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                    )}
                    
                    <div className={clsx(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0 border",
                      isUnread ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-transparent"
                    )}>
                      <Icon className="w-5 h-5" />
                    </div>
                    
                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between items-start">
                        <h4 className={clsx("text-sm", isUnread ? "font-bold text-foreground" : "font-medium text-muted-foreground")}>
                          {notification.title}
                        </h4>
                        <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                          {formatDateTime(notification.createdAt)}
                        </span>
                      </div>
                      <p className={clsx("text-sm leading-relaxed", isUnread ? "text-foreground/90" : "text-muted-foreground")}>
                        {notification.body}
                      </p>
                    </div>

                    <div className="shrink-0 flex items-center justify-center w-8">
                      {isUnread ? (
                        <button 
                          onClick={() => handleMarkRead(notification.id)}
                          className="text-primary hover:text-primary/70 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Mark as read"
                        >
                          <Circle className="w-5 h-5" />
                        </button>
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-muted-foreground/30" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
