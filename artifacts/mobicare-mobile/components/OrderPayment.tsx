import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useQueryClient } from "@tanstack/react-query";
import {
  getPatientGetOrderPaymentQueryKey,
  getPatientGetOrderQueryKey,
  getPatientListOrdersQueryKey,
  type PatientOrder,
  usePatientCheckOrderPayment,
  usePatientGetOrderPayment,
  usePatientStartCheckout,
  usePatientStartSharedCheckout,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { notify } from "@/lib/dialogs";
import { errorText, formatLeones } from "@/lib/format";
import { orderNumber } from "@/lib/orderNumber";
import { openPaymentPage } from "@/lib/payment";

/** How long "Confirming your payment…" waits before saying we'll notify. */
const CONFIRM_TIMEOUT_MS = 2 * 60_000;
const CONFIRM_POLL_MS = 3_000;
/** While a shared link is out, how often to ask Monime whether it was paid. */
const SHARED_POLL_MS = 15_000;

type Phase = "idle" | "confirming" | "slow";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The payment part of a Monime order's screen, as on the web app. After the
 * patient comes back from Monime's page, the app asks the server to check with
 * Monime until the payment is confirmed; it never trusts the return itself.
 */
export function OrderPayment({ order, returning }: { order: PatientOrder; returning: boolean }) {
  const colors = useColors();
  const s = makeStyles(colors);
  const queryClient = useQueryClient();
  const startCheckout = usePatientStartCheckout();
  const startShared = usePatientStartSharedCheckout();
  const checkPayment = usePatientCheckOrderPayment();
  const [phase, setPhase] = useState<Phase>(returning ? "confirming" : "idle");
  const [problem, setProblem] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  const awaiting = order.status === "awaiting_payment" && !order.paidAt;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getPatientGetOrderQueryKey(order.id) }),
      queryClient.invalidateQueries({ queryKey: getPatientListOrdersQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getPatientGetOrderPaymentQueryKey(order.id) }),
    ]);

  // A link already sent to someone else, so it shows again after reopening.
  const { data: payment } = usePatientGetOrderPayment(order.id, {
    query: { enabled: awaiting, queryKey: getPatientGetOrderPaymentQueryKey(order.id) },
  });
  const sharedLink =
    payment?.link?.shared && payment.link.redirectUrl && (payment.link.status === "pending" || payment.link.status === "creating")
      ? payment.link
      : null;

  // While someone else may be paying, ask Monime now and then (while the app is open).
  useEffect(() => {
    if (!awaiting || !sharedLink) return;
    const timer = setInterval(async () => {
      if (AppState.currentState !== "active") return;
      try {
        const state = await checkPayment.mutateAsync({ id: order.id });
        if (state.paid || state.orderStatus !== "awaiting_payment") await refresh();
      } catch {
        // try again next time
      }
    }, SHARED_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting, sharedLink?.redirectUrl, order.id]);

  // Back from Monime: check with the server until confirmed, then stop.
  useEffect(() => {
    if (phase !== "confirming") return;
    if (!awaiting) {
      setPhase("idle");
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const state = await checkPayment.mutateAsync({ id: order.id });
        if (stopped) return;
        if (state.paid || state.orderStatus !== "awaiting_payment") {
          await refresh();
          setPhase("idle");
          return;
        }
      } catch {
        // keep trying until the timeout
      }
      if (stopped) return;
      if (Date.now() - startedAt.current > CONFIRM_TIMEOUT_MS) setPhase("slow");
      else timer = setTimeout(tick, CONFIRM_POLL_MS);
    };
    timer = setTimeout(tick, 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, awaiting, order.id]);

  async function pay() {
    setProblem(null);
    try {
      const link = await startCheckout.mutateAsync({ id: order.id });
      if (link.status === "paid") {
        await refresh();
        return;
      }
      if (link.redirectUrl) {
        await openPaymentPage(link.redirectUrl);
        startedAt.current = Date.now();
        setPhase("confirming");
      }
    } catch (err) {
      setProblem(errorText(err));
      await refresh();
    }
  }

  async function askSomeoneElse() {
    setProblem(null);
    try {
      await startShared.mutateAsync({ id: order.id });
      await refresh();
    } catch (err) {
      setProblem(errorText(err));
      await refresh();
    }
  }

  if (order.latePaymentStatus === "refund_needed") {
    return (
      <View style={[s.card, s.amber]} testID="card-refund-needed">
        <Feather name="clock" size={18} color="#B45309" />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Payment received, order can't go ahead</Text>
          <Text style={s.meta}>
            MobiCare will refund {formatLeones(order.totalLeones)} to you. You don't need to do anything.
          </Text>
        </View>
      </View>
    );
  }

  if (!awaiting) return null;

  if (phase === "confirming" || phase === "slow") {
    return (
      <View style={[s.card, s.tint]} testID="card-confirming-payment">
        {phase === "confirming" ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather name="clock" size={18} color={colors.primary} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{phase === "confirming" ? "Confirming your payment…" : "Still waiting for the payment network"}</Text>
          <Text style={s.meta}>
            {phase === "confirming"
              ? "This usually takes a few seconds. Please keep this screen open."
              : "If you paid, there's nothing more to do: we'll notify you as soon as it's confirmed."}
          </Text>
          <Text style={[s.link, { marginTop: 8 }]} onPress={() => setPhase("idle")} testID="button-did-not-pay">
            I didn't pay — show the Pay button
          </Text>
        </View>
      </View>
    );
  }

  const rx = order.prescription?.status;
  if (rx === "pending") {
    return (
      <View style={s.card} testID="card-pay-after-approval">
        <Feather name="clock" size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Pay after the pharmacist approves</Text>
          <Text style={s.meta}>
            A licensed pharmacist is checking your prescription. We'll notify you, and then you'll have 2 hours to pay{" "}
            {formatLeones(order.totalLeones)}. Nothing is charged before that.
          </Text>
        </View>
      </View>
    );
  }
  if (rx === "rejected") return null;

  const payBy = order.payableSince ? new Date(new Date(order.payableSince).getTime() + 2 * 60 * 60 * 1000) : null;
  const busy = startCheckout.isPending || startShared.isPending;

  return (
    <View style={[s.box, { borderColor: "#8CC9B5" }]} testID="card-pay-order">
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Feather name="credit-card" size={18} color={colors.primary} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Pay {formatLeones(order.totalLeones)} to confirm your order</Text>
          <Text style={s.meta}>
            Orange Money, AfriMoney, card or bank, on Monime's secure page.
            {payBy ? ` Pay by ${payBy.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : ""}
          </Text>
        </View>
      </View>
      {problem ? <Text style={s.problem} testID="text-pay-problem">{problem}</Text> : null}
      <Pressable style={[s.primary, busy && { opacity: 0.6 }]} onPress={() => void pay()} disabled={busy} testID="button-pay-now">
        {startCheckout.isPending ? <ActivityIndicator color="#FFF" /> : null}
        <Text style={s.primaryText}>{startCheckout.isPending ? "Opening payment…" : `Pay ${formatLeones(order.totalLeones)}`}</Text>
      </Pressable>
      {sharedLink ? (
        <SharedLinkPanel
          order={order}
          url={sharedLink.redirectUrl!}
          expireTime={sharedLink.expireTime ?? null}
          onRenew={() => void askSomeoneElse()}
          renewing={startShared.isPending}
        />
      ) : (
        <Pressable style={[s.outline, busy && { opacity: 0.6 }]} onPress={() => void askSomeoneElse()} disabled={busy} testID="button-ask-someone-else">
          <Feather name="users" size={15} color={colors.darkGreen} />
          <Text style={s.outlineText}>{startShared.isPending ? "Making the link…" : "Ask someone else to pay"}</Text>
        </Pressable>
      )}
      <View style={s.safe}>
        <Feather name="shield" size={12} color={colors.mutedForeground} />
        <Text style={s.safeText}>Your payment goes to MobiCare and is released to the pharmacy after delivery.</Text>
      </View>
    </View>
  );
}

/** The message sent with the link. No medicines: only the order number and total. */
function shareMessage(order: PatientOrder, url: string, expireTime: string | null) {
  const until = expireTime ? ` The link works until ${timeOf(expireTime)}.` : "";
  return (
    `Hi, please help me pay for my MobiCare order ${orderNumber(order.id)}: ${formatLeones(order.totalLeones)}. ` +
    `You can pay with Orange Money or AfriMoney on Monime's secure page: ${url}${until}`
  );
}

function SharedLinkPanel({
  order,
  url,
  expireTime,
  onRenew,
  renewing,
}: {
  order: PatientOrder;
  url: string;
  expireTime: string | null;
  onRenew: () => void;
  renewing: boolean;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const expired = expireTime !== null && new Date(expireTime).getTime() <= now;
  const message = shareMessage(order, url, expireTime);

  return (
    <View style={s.shared} testID="panel-shared-link">
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Feather name="users" size={15} color={colors.primary} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Payment link for someone else</Text>
          <Text style={s.meta}>
            They'll see only "MobiCare order {orderNumber(order.id)}" and {formatLeones(order.totalLeones)}, not your medicines.
          </Text>
        </View>
      </View>
      {expired ? (
        <>
          <Text style={s.problem} testID="text-shared-link-expired">This link has expired. Make a new one and send it again.</Text>
          <Pressable style={s.outline} onPress={onRenew} disabled={renewing} testID="button-renew-shared-link">
            <Text style={s.outlineText}>{renewing ? "Making a new link…" : "Make a new link"}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              style={[s.primary, { flex: 1, height: 42 }]}
              onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`)}
              testID="button-share-whatsapp"
            >
              <Feather name="message-circle" size={15} color="#FFF" />
              <Text style={s.primaryText}>WhatsApp</Text>
            </Pressable>
            <Pressable
              style={[s.outline, { flex: 1 }]}
              onPress={async () => {
                await Clipboard.setStringAsync(message);
                notify("Copied", "Paste it into WhatsApp or SMS for the person paying.");
              }}
              testID="button-copy-shared-link"
            >
              <Feather name="copy" size={15} color={colors.darkGreen} />
              <Text style={s.outlineText}>Copy</Text>
            </Pressable>
          </View>
          <Pressable
            style={{ alignItems: "center", paddingVertical: 4 }}
            onPress={() => void Share.share({ message }).catch(() => {})}
            testID="button-share-other"
          >
            <Text style={s.link}>Share another way</Text>
          </Pressable>
          <Text style={s.url} selectable testID="text-shared-link-url">
            {url}
          </Text>
          <Text style={s.meta}>
            {expireTime ? `Works until ${timeOf(expireTime)}. ` : ""}We'll let you know as soon as it's paid.
          </Text>
        </>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      gap: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      marginHorizontal: 16,
      marginBottom: 12,
    },
    amber: { borderColor: "#FCD34D", backgroundColor: "#FFFBEB" },
    tint: { borderColor: "#8CC9B5", backgroundColor: "#F0F8F4" },
    box: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      gap: 10,
      marginHorizontal: 16,
      marginBottom: 12,
    },
    title: { fontSize: 14.5, fontWeight: "700", color: colors.darkGreen },
    meta: { fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18, marginTop: 2 },
    link: { fontSize: 12.5, color: colors.primary, fontWeight: "600" },
    problem: { fontSize: 12.5, color: colors.destructive },
    primary: {
      flexDirection: "row",
      gap: 8,
      height: 46,
      borderRadius: 999,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
    outline: {
      flexDirection: "row",
      gap: 8,
      height: 44,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    outlineText: { color: colors.darkGreen, fontWeight: "600", fontSize: 14 },
    safe: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
    safeText: { fontSize: 11, color: colors.mutedForeground, flexShrink: 1 },
    shared: { borderWidth: 1, borderColor: "#A7D8C6", backgroundColor: "#F0F8F4", borderRadius: 12, padding: 12, gap: 8 },
    url: { fontSize: 11, color: colors.mutedForeground },
  });
}
