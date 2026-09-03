import React from 'react';
import {
  FlatList,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PatientNotification,
  getGetPatientUnreadCountQueryKey,
  getListPatientNotificationsQueryKey,
  useGetPatientUnreadCount,
  useListPatientNotifications,
  useMarkPatientNotificationsRead,
  useClearPatientNotifications,
  useDeletePatientNotification,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { MobiCareHeader } from '@/components/MobiCareHeader';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function notifIcon(type: string | null | undefined): { name: string; color: (c: ReturnType<typeof import('@/hooks/useColors').useColors>) => string } {
  switch (type) {
    case 'prescription_rejected': return { name: 'document-text-outline', color: (c) => c.destructive };
    case 'order_cancelled': return { name: 'close-circle-outline', color: (c) => c.destructive };
    case 'order_status': return { name: 'checkmark-circle-outline', color: (c) => c.primary };
    default: return { name: 'notifications-outline', color: (c) => c.mutedForeground };
  }
}

function NotifCard({
  notif,
  colors,
  onDelete,
}: {
  notif: PatientNotification;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
  onDelete: (id: string) => void;
}) {
  const s = makeStyles(colors);
  const icon = notifIcon(notif.type);
  const isUnread = !notif.readAt;

  const handlePress = () => {
    if (notif.referenceId) router.push(`/order/${notif.referenceId}`);
  };

  return (
    <Pressable style={[s.card, isUnread && s.cardUnread]} onPress={handlePress} disabled={!notif.referenceId}>
      <View style={[s.iconWrap, { backgroundColor: isUnread ? colors.secondary : '#F3F4F6' }]}>
        <Ionicons name={icon.name as 'notifications-outline'} size={22} color={icon.color(colors)} />
      </View>
      <View style={s.content}>
        <View style={s.cardTitleRow}>
          <Text style={[s.title, isUnread && s.titleUnread]} numberOfLines={2}>{notif.title}</Text>
          {isUnread && <View style={s.dot} />}
        </View>
        <Text style={s.body} numberOfLines={3}>{notif.body}</Text>
        <Text style={s.time}>{timeAgo(notif.createdAt)}</Text>
        {(notif.type === 'prescription_rejected' || notif.type === 'order_cancelled') && (
          <View style={s.actionHint}>
            <Ionicons name="arrow-forward-outline" size={12} color={colors.accent} />
            <Text style={s.actionHintText}>Tap to view order details</Text>
          </View>
        )}
      </View>
      <Pressable
        style={s.deleteButton}
        accessibilityRole="button"
        accessibilityLabel="Delete notification"
        onPress={(event) => {
          event.stopPropagation();
          onDelete(notif.id);
        }}
      >
        <Ionicons name="trash-outline" size={19} color={colors.destructive} />
      </Pressable>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const isWeb = Platform.OS === 'web';
  const topPad = isWeb ? insets.top + 67 : insets.top;
  const canQuery = !isAuthLoading && isAuthenticated;

  const { data: notifications, isFetching, refetch } = useListPatientNotifications({
    query: {
      queryKey: getListPatientNotificationsQueryKey(),
      enabled: canQuery,
      refetchInterval: canQuery ? 30_000 : false,
    },
  });

  const { data: unreadData } = useGetPatientUnreadCount({
    query: {
      queryKey: getGetPatientUnreadCountQueryKey(),
      enabled: canQuery,
      refetchInterval: canQuery ? 30_000 : false,
    },
  });

  const markRead = useMarkPatientNotificationsRead();
  const clearNotifications = useClearPatientNotifications();
  const deleteNotification = useDeletePatientNotification();
  const refreshNotifications = () => {
    queryClient.invalidateQueries({ queryKey: getListPatientNotificationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPatientUnreadCountQueryKey() });
  };

  const deleteOne = (id: string) => {
    Alert.alert('Delete notification?', 'This notification will be removed permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteNotification.mutate({ id }, { onSuccess: refreshNotifications });
        },
      },
    ]);
  };

  const clearAll = () => {
    Alert.alert('Clear all notifications?', 'All notifications will be removed permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear all',
        style: 'destructive',
        onPress: () => {
          clearNotifications.mutate(undefined, { onSuccess: refreshNotifications });
        },
      },
    ]);
  };

  // Mark all as read when tab comes into focus
  useFocusEffect(
    React.useCallback(() => {
      if (unreadData && unreadData.unreadCount > 0) {
        markRead.mutateAsync({ data: undefined }).then(() => {
          queryClient.invalidateQueries({ queryKey: getListPatientNotificationsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPatientUnreadCountQueryKey() });
        }).catch(() => {});
      }
    }, [unreadData?.unreadCount])
  );

  const s = makeStyles(colors);

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      <MobiCareHeader />
      <View style={s.headerRow}>
        <Text style={s.screenTitle}>Notifications</Text>
        {(unreadData?.unreadCount ?? 0) > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{unreadData!.unreadCount}</Text>
          </View>
        )}
        {!!notifications?.length && (
          <Pressable
            style={s.clearButton}
            onPress={clearAll}
            disabled={clearNotifications.isPending}
            accessibilityRole="button"
          >
            <Ionicons name="trash-outline" size={16} color={colors.destructive} />
            <Text style={s.clearButtonText}>Clear all</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={notifications ?? []}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => <NotifCard notif={item} colors={colors} onDelete={deleteOne} />}
        contentContainerStyle={[
          s.list,
          isWeb ? { paddingBottom: insets.bottom + 34 } : {},
          (notifications ?? []).length === 0 ? s.listEmpty : {},
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!(notifications && notifications.length > 0)}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isFetching ? (
            <View style={s.empty}>
              <Ionicons name="notifications-off-outline" size={56} color={colors.border} />
              <Text style={s.emptyTitle}>All caught up</Text>
              <Text style={s.emptyBody}>You have no notifications yet.</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof import('@/hooks/useColors').useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 16 },
    screenTitle: { fontSize: 26, fontWeight: '800', color: colors.darkGreen },
    badge: { backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
    badgeText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
    clearButton: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, padding: 8 },
    clearButtonText: { color: colors.destructive, fontSize: 13, fontWeight: '700' },
    list: { paddingHorizontal: 16, paddingBottom: 120, gap: 8 },
    listEmpty: { flex: 1 },
    card: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: colors.radius + 4,
      padding: 14,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardUnread: { borderColor: colors.primary, backgroundColor: '#F0FBF5' },
    iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    content: { flex: 1, gap: 4 },
    deleteButton: { alignSelf: 'flex-start', padding: 4 },
    cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    title: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.foreground },
    titleUnread: { fontWeight: '700' },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 4, flexShrink: 0 },
    body: { fontSize: 13, color: colors.mutedForeground, lineHeight: 18 },
    time: { fontSize: 11, color: colors.mutedForeground },
    actionHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    actionHintText: { fontSize: 11, color: colors.accent, fontWeight: '600' },
    empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12, paddingHorizontal: 32 },
    emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.foreground },
    emptyBody: { fontSize: 14, color: colors.mutedForeground, textAlign: 'center' },
  });
}
