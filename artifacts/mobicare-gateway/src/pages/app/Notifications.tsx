import { useLocation } from 'wouter';
import { Bell, ChevronRight, AlertTriangle, Trash2 } from 'lucide-react';
import {
  useClearPatientNotifications,
  useDeletePatientNotification,
  useListPatientNotifications,
  useMarkPatientNotificationsRead,
  getListPatientNotificationsQueryKey,
  getGetPatientUnreadCountQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/pages/hq/shared';
import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationsPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: notifications, isLoading } = useListPatientNotifications({
    query: {
      refetchInterval: 30_000,
      queryKey: getListPatientNotificationsQueryKey(),
    },
  });
  const markRead = useMarkPatientNotificationsRead();
  const clearNotifications = useClearPatientNotifications();
  const deleteNotification = useDeletePatientNotification();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetPatientUnreadCountQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPatientNotificationsQueryKey() });
  };

  const removeOne = async (id: string) => {
    try {
      await deleteNotification.mutateAsync({ id });
      refresh();
    } catch (error) {
      toast({
        title: 'Could not delete notification',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const clearAll = async () => {
    if (!window.confirm('Delete all notifications? This cannot be undone.')) return;
    try {
      await clearNotifications.mutateAsync();
      refresh();
      toast({ title: 'Notifications cleared' });
    } catch (error) {
      toast({
        title: 'Could not clear notifications',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Mark all as read when the page is opened
  useEffect(() => {
    markRead.mutate(
      { data: {} },
      {
        onSuccess: () => {
          // Invalidate the unread count so the bell badge clears
          queryClient.invalidateQueries({ queryKey: getGetPatientUnreadCountQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getListPatientNotificationsQueryKey(),
          });
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl text-dark-green mb-1">Notifications</h1>
          <p className="text-sm text-muted-foreground">Updates on your orders and prescriptions.</p>
        </div>
        {!!notifications?.length && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void clearAll()}
            disabled={clearNotifications.isPending}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear all
          </Button>
        )}
      </div>

      {isLoading && <EmptyState>Loading notifications…</EmptyState>}
      {notifications && notifications.length === 0 && (
        <EmptyState>
          <Bell className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No notifications yet. We'll alert you when your order status changes.
        </EmptyState>
      )}

      <div className="space-y-2">
        {notifications?.map((n) => {
          const isRejection = n.type === 'prescription_rejected';
          const isUnread = !n.readAt;

          return (
            <div key={n.id}>
              {n.referenceId ? (
                  <Card
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/app/orders/${n.referenceId}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') navigate(`/app/orders/${n.referenceId}`);
                    }}
                    className={`cursor-pointer hover:border-primary/50 transition-colors ${
                      isRejection ? 'border-destructive/50 bg-destructive/5' : ''
                    } ${isUnread ? 'border-primary/30 bg-primary/5' : ''}`}
                    data-testid={`notif-${n.id}`}
                  >
                    <CardContent className="p-4 flex items-start gap-3">
                      <div
                        className={`mt-0.5 rounded-full p-1.5 shrink-0 ${
                          isRejection
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-primary/10 text-primary'
                        }`}
                      >
                        {isRejection ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : (
                          <Bell className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold truncate ${isRejection ? 'text-destructive' : ''}`}>
                            {n.title}
                          </span>
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                        {isRejection && (
                          <p className="text-xs text-destructive mt-1 font-medium">
                            Tap to view order details and next steps.
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt as unknown as string)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="Delete notification"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeOne(n.id);
                        }}
                        disabled={deleteNotification.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-2.5" />
                    </CardContent>
                  </Card>
              ) : (
                <Card
                  className={`${isRejection ? 'border-destructive/50 bg-destructive/5' : ''}`}
                  data-testid={`notif-${n.id}`}
                >
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className={`mt-0.5 rounded-full p-1.5 shrink-0 ${isRejection ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                      {isRejection ? <AlertTriangle className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold truncate ${isRejection ? 'text-destructive' : ''}`}>
                          {n.title}
                        </span>
                        {isUnread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt as unknown as string)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Delete notification"
                      onClick={() => void removeOne(n.id)}
                      disabled={deleteNotification.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
