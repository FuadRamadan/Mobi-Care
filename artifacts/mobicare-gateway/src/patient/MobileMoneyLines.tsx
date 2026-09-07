/**
 * The mobile money numbers a pharmacy accepts payment on.
 *
 * Patients pay the pharmacy directly, so this is the payment instruction, not a
 * detail — which is why an empty list says so plainly rather than rendering
 * nothing. A patient who cannot see a number has no way to complete the order,
 * and a blank space does not tell them that.
 *
 * Shown in both the search results and at checkout, so the two never disagree
 * about how a payment line is presented.
 */

import type { MobileMoneyLine } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export function MobileMoneyLines({
  lines,
  accountName,
  emptyText = "Not provided",
}: {
  lines: MobileMoneyLine[] | undefined;
  accountName?: string | null;
  emptyText?: string;
}) {
  const { toast } = useToast();

  if (!lines || lines.length === 0) {
    return <span className="text-muted-foreground italic">{emptyText}</span>;
  }

  return (
    <div className="space-y-1">
      {lines.map((line) => (
        <div key={`${line.provider}-${line.number}`}>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="font-medium">{line.number}</span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(line.number);
                toast({ title: `${line.provider} number copied` });
              }}
              className="text-primary hover:underline text-[10px]"
              data-testid={`button-copy-${line.provider.replace(/\s+/g, "-").toLowerCase()}`}
            >
              Copy
            </button>
          </div>
          <div className="text-muted-foreground">{line.provider}</div>
        </div>
      ))}
      {accountName && (
        <div className="text-muted-foreground">Account name: {accountName}</div>
      )}
    </div>
  );
}
