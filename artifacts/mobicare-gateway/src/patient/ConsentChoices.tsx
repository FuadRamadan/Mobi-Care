/**
 * The two consent decisions, as the patient makes them.
 *
 * Presented as two separate choices rather than one bundled "I agree", because
 * they are not the same kind of thing. The first is what makes it lawful to
 * hold someone's prescription at all. The second is optional, and refusing it
 * costs nothing — which is the only thing that makes it consent rather than a
 * toll on the way in.
 *
 * The optional one starts ticked (decided 11 Oct 2026, policy 2026-10-11),
 * with what it covers written beside it and an untick that costs nothing.
 * Anyone who already said no is not ticked again: see ConsentGate.
 */

import { Checkbox } from "@/components/ui/checkbox";

export interface ConsentChoiceState {
  termsAndPrivacy: boolean;
  researchAnalytics: boolean;
}

export const EMPTY_CONSENT: ConsentChoiceState = {
  termsAndPrivacy: false,
  researchAnalytics: true,
};

export function ConsentChoices({
  value,
  onChange,
  disabled,
}: {
  value: ConsentChoiceState;
  onChange: (next: ConsentChoiceState) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="flex gap-3 items-start cursor-pointer">
        <Checkbox
          checked={value.termsAndPrivacy}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ ...value, termsAndPrivacy: checked === true })
          }
          className="mt-0.5"
          data-testid="checkbox-terms"
        />
        <span className="text-xs leading-relaxed">
          <span className="font-medium">
            I agree to the{" "}
            <a href="/terms" target="_blank" rel="noopener" className="text-primary underline">terms</a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" rel="noopener" className="text-primary underline">privacy notice</a>.
          </span>{" "}
          <span className="text-muted-foreground">
            MobiCare holds your details, prescriptions and orders. A pharmacy you
            order from sees what it needs to dispense your medicine.
          </span>
        </span>
      </label>

      <label className="flex gap-3 items-start cursor-pointer">
        <Checkbox
          checked={value.researchAnalytics}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ ...value, researchAnalytics: checked === true })
          }
          className="mt-0.5"
          data-testid="checkbox-research"
        />
        <span className="text-xs leading-relaxed">
          <span className="font-medium">Help improve medicine access.</span>{" "}
          <span className="text-muted-foreground">
            Optional. Counts your searches, including medicines you could not find
            and your area (zone or district, never your exact location), in
            combined figures shared with health authorities and partners. Never
            your name, prescriptions or orders. Untick to say no; it changes
            nothing about your orders, and you can change your mind later.
          </span>
        </span>
      </label>
    </div>
  );
}
