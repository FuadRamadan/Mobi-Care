import { CheckCircle2, XCircle } from 'lucide-react';
import { CONTACT_EMAIL } from '@/config/portals';

/**
 * Where Monime sends someone who paid (or cancelled) through a link a patient
 * shared ("Ask someone else to pay"). Public: the payer has no MobiCare
 * sign-in. It shows nothing about the order beyond its number, and does not
 * claim the payment succeeded: MobiCare confirms that with Monime itself.
 */
export default function PaymentDone() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('order') ?? '';
  const orderNumber = /^[0-9A-F]{8}$/.test(raw) ? raw : null;
  const cancelled = params.get('result') === 'cancelled';
  const order = orderNumber ? `MobiCare order ${orderNumber}` : 'the MobiCare order';

  return (
    <section className="min-h-[60vh] flex items-center justify-center px-4 py-16 bg-secondary/30">
      <div className="max-w-md w-full bg-white rounded-2xl border p-6 text-center space-y-3 shadow-sm" data-testid="payment-done">
        {cancelled ? (
          <>
            <XCircle className="w-10 h-10 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-semibold text-dark-green">Payment not completed</h1>
            <p className="text-sm text-muted-foreground">
              Nothing was charged for {order}. You can open the same link again to pay. If it has expired, ask the
              person who sent it for a new one.
            </p>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-10 h-10 mx-auto text-primary" />
            <h1 className="text-xl font-semibold text-dark-green">Thank you!</h1>
            <p className="text-sm text-muted-foreground">
              MobiCare is confirming your payment for {order}. The person who sent you the link will see it in their
              MobiCare app within a few minutes. You don't need to do anything else.
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground pt-2 border-t">
          Money left your account but something looks wrong? Contact MobiCare on{' '}
          <a href="tel:+23275726975" className="text-primary font-medium">+232 75 726 975</a> or{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary font-medium whitespace-nowrap">{CONTACT_EMAIL}</a>
          {orderNumber && <> and give the order number {orderNumber}</>}.
        </p>
      </div>
    </section>
  );
}
