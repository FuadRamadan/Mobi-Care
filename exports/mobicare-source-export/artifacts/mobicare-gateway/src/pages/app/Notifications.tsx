import { Link } from 'wouter';
import { Bell, ChevronRight, AlertTriangle } from 'lucide-react';
import {
  useListPatientNotifications,
  useMarkPatientNotificationsRead,
  getListPatientNotificationsQueryKey,
  getGetPatientUnreadCountQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/pages/hq/shared';
import { useEffect } from 'react';

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
  const queryClient = useQueryClient();
  const { data: notifications, isLoading } = useListPatientNotifications({
    query: {
      refetchInterval: 30_000,
      queryKey: getListPatientNotificationsQueryKey(),
    },
  });
  const markRead = useMarkPatientNotificationsRead();

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
      <div>
        <h1 className="font-display font-bold text-2xl text-dark-green mb-1">Notifications</h1>
        <p className="text-sm text-muted-foreground">Updates on your orders and prescriptions.</p>
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
                <Link href={`/app/orders/${n.referenceId}`}>
                  <Card
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
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    </CardContent>
                  </Card>
                </Link>
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
