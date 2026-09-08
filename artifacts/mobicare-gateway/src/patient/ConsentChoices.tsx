/**
 * The two consent decisions, as the patient makes them.
 *
 * Presented as two separate choices rather than one bundled "I agree", because
 * they are not the same kind of thing. The first is what makes it lawful to
 * hold someone's prescription at all. The second is optional, and refusing it
 * costs nothing — which is the only thing that makes it consent rather than a
 * toll on the way in.
 *
 * The optional one is deliberately unticked. A pre-ticked box is not a decision
 * anybody made.
 */

import { Checkbox } from "@/components/ui/checkbox";

export interface ConsentChoiceState {
  termsAndPrivacy: boolean;
  researchAnalytics: boolean;
}

export const EMPTY_CONSENT: ConsentChoiceState = {
  termsAndPrivacy: false,
  researchAnalytics: false,
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
          <span className="font-medium">I agree to the terms and privacy notice.</span>{" "}
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
            Optional. Lets your searches count towards the anonymous figures that
            show where medicines are hard to find — never your name, prescriptions
            or orders. Saying no changes nothing about your orders, and you can
            change your mind later.
          </span>
        </span>
      </label>
    </div>
  );
}
