import { useListNotifications, useMarkNotificationsRead, getListNotificationsQueryKey, getGetUnreadCountQueryKey, useClearNotifications, useDeleteNotification } from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/format";
import { markNotificationsReadAndRefresh } from "@/lib/notification-read";
import { Button } from "@/components/ui/button";
import { Check, CheckCircle2, Circle, Bell, Activity, Package, FileText, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import clsx from "clsx";
import { useLocation } from "wouter";

function destinationForNotification(type: string | null | undefined) {
  if (type === "prescription_submitted") return "/prescriptions";
  if (type === "order_cancelled") return "/orders?tab=cancelled";
  if (type === "drug_request_approved" || type === "drug_request_rejected")
    return "/inventory";
  return "/orders";
}

function iconForNotification(type: string | null | undefined) {
  if (type === "prescription_submitted") return FileText;
  if (type === "system") return Activity;
  return Package;
}

export default function Notifications() {
  const [, setLocation] = useLocation();
  const { data: notifications, isLoading } = useListNotifications({
    query: { refetchInterval: 15_000, queryKey: getListNotificationsQueryKey() },
  });
  const markRead = useMarkNotificationsRead();
  const clearNotifications = useClearNotifications();
  const deleteNotification = useDeleteNotification();
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetUnreadCountQueryKey() });
  };

  const handleMarkAllRead = async () => {
    try {
      await markNotificationsReadAndRefresh(
        markRead.mutateAsync,
        queryClient,
      );
      toast.success("All notifications marked as read");
    } catch (e: any) {
      toast.error("Failed to mark notifications");
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await markNotificationsReadAndRefresh(
        markRead.mutateAsync,
        queryClient,
        [id],
      );
    } catch (e: any) {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNotification.mutateAsync({ id });
      refresh();
      toast.success("Notification deleted");
    } catch {
      toast.error("Failed to delete notification");
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm("Delete all notifications? This cannot be undone.")) return;
    try {
      await clearNotifications.mutateAsync();
      refresh();
      toast.success("Notifications cleared");
    } catch {
      toast.error("Failed to clear notifications");
    }
  };

  const hasUnread = notifications?.some(n => !n.readAt);

  return (
    <div className="max-w-4xl mx-auto space-y-6 flex flex-col h-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1 text-sm">Updates on orders, prescriptions, and system alerts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasUnread && (
            <Button variant="outline" size="sm" onClick={handleMarkAllRead} disabled={markRead.isPending}>
              <Check className="w-4 h-4 mr-2" /> Mark all as read
            </Button>
          )}
          {!!notifications?.length && (
            <Button variant="outline" size="sm" onClick={handleClearAll} disabled={clearNotifications.isPending}>
              <Trash2 className="w-4 h-4 mr-2" /> Clear all
            </Button>
          )}
        </div>
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
                
                const Icon = iconForNotification(notification.type);
                const destination = destinationForNotification(notification.type);

                return (
                  <div 
                    key={notification.id} 
                    className={clsx(
                      "p-3 sm:p-4 flex gap-3 sm:gap-4 transition-colors relative group cursor-pointer",
                      isUnread ? "bg-primary/5" : "hover:bg-muted/30"
                    )}
                    onClick={() => {
                      if (isUnread) void handleMarkRead(notification.id);
                      setLocation(destination);
                    }}
                  >
                    {isUnread && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                    )}
                    
                    <div className={clsx(
                      "hidden sm:flex w-10 h-10 rounded-full items-center justify-center shrink-0 border",
                      isUnread ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-transparent"
                    )}>
                      <Icon className="w-5 h-5" />
                    </div>
                    
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-1">
                        <h4 className={clsx("text-sm", isUnread ? "font-bold text-foreground" : "font-medium text-muted-foreground")}>
                          {notification.title}
                        </h4>
                        <span className="text-xs text-muted-foreground whitespace-nowrap sm:ml-4">
                          {formatDateTime(notification.createdAt)}
                        </span>
                      </div>
                      <p className={clsx("text-sm leading-relaxed", isUnread ? "text-foreground/90" : "text-muted-foreground")}>
                        {notification.body}
                      </p>
                    </div>

                    <div className="shrink-0 flex items-center justify-center gap-1">
                      {isUnread ? (
                        <button 
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleMarkRead(notification.id);
                          }}
                          className="text-primary hover:text-primary/70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                          aria-label="Mark notification as read"
                          title="Mark as read"
                        >
                          <Circle className="w-5 h-5" />
                        </button>
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-muted-foreground/30" />
                      )}
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDelete(notification.id);
                        }}
                        className="p-1 text-muted-foreground hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        aria-label="Delete notification"
                        title="Delete"
                        disabled={deleteNotification.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
