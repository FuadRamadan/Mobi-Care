import { useEffect, useState } from 'react';
import { Copy, MessageCircle, Share2, Users } from 'lucide-react';
import type { PatientOrder } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { formatLeones } from '@/pages/hq/shared';

/** The order number Monime's page shows: the first 8 characters of the ID. */
export const shortOrderNumber = (orderId: string) => orderId.replace(/-/g, '').slice(0, 8).toUpperCase();

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The message sent with the link. No medicines: only the order number and total. */
export function shareMessage(order: PatientOrder, url: string, expireTime: string | null) {
  const until = expireTime ? ` The link works until ${timeOf(expireTime)}.` : '';
  return (
    `Hi, please help me pay for my MobiCare order ${shortOrderNumber(order.id)}: ${formatLeones(order.totalLeones)}. ` +
    `You can pay with Orange Money or AfriMoney on Monime's secure page: ${url}${until}`
  );
}

/**
 * A live "Ask someone else to pay" link: ways to send it, how long it works,
 * and a way to make a new one once it has expired.
 */
export function SharedLinkPanel({
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
  const { toast } = useToast();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const expired = expireTime !== null && new Date(expireTime).getTime() <= now;
  const message = shareMessage(order, url, expireTime);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: 'Copied', description: 'Paste it into WhatsApp or SMS for the person paying.' });
    } catch {
      toast({ title: "Couldn't copy", description: 'Press and hold the link below to copy it.', variant: 'destructive' });
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'MobiCare payment', text: message });
    } catch {
      // Closed the share sheet: nothing to do.
    }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="panel-shared-link">
      <div className="flex gap-2 text-sm">
        <Users className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-dark-green">Payment link for someone else</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            They'll see only "MobiCare order {shortOrderNumber(order.id)}" and {formatLeones(order.totalLeones)}, not
            your medicines.
          </p>
        </div>
      </div>

      {expired ? (
        <>
          <p className="text-xs text-destructive" data-testid="text-shared-link-expired">
            This link has expired. Make a new one and send it again.
          </p>
          <Button
            variant="outline"
            className="w-full rounded-full"
            onClick={onRenew}
            disabled={renewing}
            data-testid="button-renew-shared-link"
          >
            {renewing ? 'Making a new link…' : 'Make a new link'}
          </Button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button asChild className="rounded-full" data-testid="button-share-whatsapp">
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="w-4 h-4 mr-1.5" /> WhatsApp
              </a>
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => void copy()} data-testid="button-copy-shared-link">
              <Copy className="w-4 h-4 mr-1.5" /> Copy
            </Button>
          </div>
          {canShare && (
            <Button
              variant="ghost"
              className="w-full rounded-full h-9 text-xs"
              onClick={() => void share()}
              data-testid="button-share-other"
            >
              <Share2 className="w-3.5 h-3.5 mr-1.5" /> Share another way
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground break-all select-all" data-testid="text-shared-link-url">
            {url}
          </p>
          <p className="text-xs text-muted-foreground">
            {expireTime && <>Works until {timeOf(expireTime)}. </>}
            We'll let you know as soon as it's paid.
          </p>
        </>
      )}
    </div>
  );
}
