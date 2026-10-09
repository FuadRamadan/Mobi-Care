import { useEffect, useRef, useState } from 'react';
import { Clock, CreditCard, Loader2, ShieldCheck, Users, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getPatientGetOrderPaymentQueryKey,
  getPatientGetOrderQueryKey,
  getPatientListOrdersQueryKey,
  usePatientCheckOrderPayment,
  usePatientGetOrderPayment,
  usePatientStartCheckout,
  usePatientStartSharedCheckout,
  type PatientOrder,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatLeones } from '@/pages/hq/shared';
import { SharedLinkPanel } from './SharePayment';

/** How long "Confirming your payment…" waits before saying we'll notify. */
const CONFIRM_TIMEOUT_MS = 2 * 60_000;
const CONFIRM_POLL_MS = 3_000;
/** While a shared link is out, how often to ask Monime whether it was paid. */
const SHARED_POLL_MS = 15_000;

type Phase = 'idle' | 'confirming' | 'slow' | 'cancelled';

const errorText = (err: unknown) =>
  (err as { data?: { error?: string } } | null)?.data?.error ?? 'Something went wrong. Please try again.';

/**
 * The payment part of a Monime order's page. The page is also where Monime
 * sends the patient back to: ?payment=return after paying (we confirm with
 * Monime before showing "paid"), ?payment=cancelled after cancelling.
 */
export function OrderPayment({ order }: { order: PatientOrder }) {
  const queryClient = useQueryClient();
  const startCheckout = usePatientStartCheckout();
  const startShared = usePatientStartSharedCheckout();
  const checkPayment = usePatientCheckOrderPayment();
  const [phase, setPhase] = useState<Phase>(() => {
    const flag = new URLSearchParams(window.location.search).get('payment');
    return flag === 'return' ? 'confirming' : flag === 'cancelled' ? 'cancelled' : 'idle';
  });
  const [problem, setProblem] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  const awaiting = order.status === 'awaiting_payment' && !order.paidAt;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getPatientGetOrderQueryKey(order.id) }),
      queryClient.invalidateQueries({ queryKey: getPatientListOrdersQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getPatientGetOrderPaymentQueryKey(order.id) }),
    ]);

  // A link already sent to someone else, so it shows again after a reload.
  const { data: payment } = usePatientGetOrderPayment(order.id, {
    query: { enabled: awaiting, queryKey: getPatientGetOrderPaymentQueryKey(order.id) },
  });
  const sharedLink =
    payment?.link?.shared && payment.link.redirectUrl && (payment.link.status === 'pending' || payment.link.status === 'creating')
      ? payment.link
      : null;

  // While someone else may be paying, ask Monime now and then, so the order
  // turns paid without waiting for Monime's notification.
  useEffect(() => {
    if (!awaiting || !sharedLink) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const state = await checkPayment.mutateAsync({ id: order.id });
        if (state.paid || state.orderStatus !== 'awaiting_payment') await refresh();
      } catch {
        // try again next time
      }
    }, SHARED_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting, sharedLink?.redirectUrl, order.id]);

  // Coming back from Monime: ask our server to check with Monime until the
  // payment is confirmed, then stop. Never trust the return address itself.
  useEffect(() => {
    if (phase !== 'confirming') return;
    if (!awaiting) {
      setPhase('idle');
      return;
    }
    let stopped = false;
    const tick = async () => {
      try {
        const state = await checkPayment.mutateAsync({ id: order.id });
        if (stopped) return;
        if (state.paid || state.orderStatus !== 'awaiting_payment') {
          await refresh();
          setPhase('idle');
          return;
        }
      } catch {
        // keep trying until the timeout
      }
      if (stopped) return;
      if (Date.now() - startedAt.current > CONFIRM_TIMEOUT_MS) setPhase('slow');
      else timer = window.setTimeout(tick, CONFIRM_POLL_MS);
    };
    let timer = window.setTimeout(tick, 500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, awaiting, order.id]);

  // Once handled, drop ?payment=… so a refresh doesn't replay it.
  useEffect(() => {
    if (phase === 'idle' && window.location.search.includes('payment=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [phase]);

  async function pay() {
    setProblem(null);
    try {
      const link = await startCheckout.mutateAsync({ id: order.id });
      if (link.status === 'paid') {
        await refresh();
        return;
      }
      if (link.redirectUrl) window.location.assign(link.redirectUrl);
    } catch (err) {
      setProblem(errorText(err));
      await refresh();
    }
  }

  async function askSomeoneElse() {
    setProblem(null);
    try {
      const link = await startShared.mutateAsync({ id: order.id });
      queryClient.setQueryData(getPatientGetOrderPaymentQueryKey(order.id), (old: typeof payment) =>
        old && link.status === 'pending' ? { ...old, link: { ...link, status: 'pending' } } : old,
      );
      await refresh();
    } catch (err) {
      setProblem(errorText(err));
      await refresh();
    }
  }

  if (order.latePaymentStatus === 'refund_needed') {
    return (
      <Card className="border-amber-300 bg-amber-50" data-testid="card-refund-needed">
        <CardContent className="p-4 flex gap-3 text-sm">
          <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Payment received, order can't go ahead</div>
            <p className="text-xs text-muted-foreground mt-1">
              MobiCare will refund {formatLeones(order.totalLeones)} to you. You don't need to do anything.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!awaiting) return null;

  if (phase === 'confirming' || phase === 'slow') {
    return (
      <Card className="border-primary/40 bg-primary/5" data-testid="card-confirming-payment">
        <CardContent className="p-4 flex gap-3 text-sm">
          {phase === 'confirming' ? (
            <Loader2 className="w-5 h-5 text-primary shrink-0 mt-0.5 animate-spin" />
          ) : (
            <Clock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          )}
          <div>
            <div className="font-semibold text-dark-green">
              {phase === 'confirming' ? 'Confirming your payment…' : 'Still waiting for the payment network'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {phase === 'confirming'
                ? 'This usually takes a few seconds. Please keep this page open.'
                : "If you paid, there's nothing more to do: we'll notify you as soon as it's confirmed."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rx = order.prescription?.status;
  if (rx === 'pending') {
    return (
      <Card data-testid="card-pay-after-approval">
        <CardContent className="p-4 flex gap-3 text-sm">
          <Clock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Pay after the pharmacist approves</div>
            <p className="text-xs text-muted-foreground mt-1">
              A licensed pharmacist is checking your prescription. We'll notify you, and then you'll have 2 hours to pay
              {' '}{formatLeones(order.totalLeones)}. Nothing is charged before that.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (rx === 'rejected') return null;

  const payBy = order.payableSince ? new Date(new Date(order.payableSince).getTime() + 2 * 60 * 60 * 1000) : null;

  return (
    <Card className="border-primary/40" data-testid="card-pay-order">
      <CardContent className="p-4 space-y-3">
        {phase === 'cancelled' && (
          <div className="flex gap-2 text-sm text-muted-foreground" data-testid="text-payment-cancelled">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            Payment cancelled. Nothing was charged. You can pay whenever you're ready.
          </div>
        )}
        <div className="flex gap-3">
          <CreditCard className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold text-dark-green">Pay {formatLeones(order.totalLeones)} to confirm your order</div>
            <p className="text-xs text-muted-foreground mt-1">
              Orange Money, AfriMoney, card or bank, on Monime's secure page.
              {payBy && ` Pay by ${payBy.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`}
            </p>
          </div>
        </div>
        {problem && <p className="text-xs text-destructive" data-testid="text-pay-problem">{problem}</p>}
        <Button
          className="w-full rounded-full h-11"
          onClick={() => void pay()}
          disabled={startCheckout.isPending || startShared.isPending}
          data-testid="button-pay-now"
        >
          {startCheckout.isPending ? 'Opening payment…' : `Pay ${formatLeones(order.totalLeones)}`}
        </Button>
        {sharedLink ? (
          <SharedLinkPanel
            order={order}
            url={sharedLink.redirectUrl!}
            expireTime={sharedLink.expireTime}
            onRenew={() => void askSomeoneElse()}
            renewing={startShared.isPending}
          />
        ) : (
          <Button
            variant="outline"
            className="w-full rounded-full h-11"
            onClick={() => void askSomeoneElse()}
            disabled={startCheckout.isPending || startShared.isPending}
            data-testid="button-ask-someone-else"
          >
            <Users className="w-4 h-4 mr-2" />
            {startShared.isPending ? 'Making the link…' : 'Ask someone else to pay'}
          </Button>
        )}
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5" /> Your payment goes to MobiCare and is released to the pharmacy after delivery.
        </p>
      </CardContent>
    </Card>
  );
}
