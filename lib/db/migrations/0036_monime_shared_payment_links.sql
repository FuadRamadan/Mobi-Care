-- "Ask someone else to pay": a patient can send the payment link to someone
-- else. Such a link lists no medicines (one line, "MobiCare order <number>")
-- and returns the payer to a public page. Only one link per order is live at a
-- time, shared or not; this records which kind it is.
ALTER TABLE monime_checkout_sessions ADD COLUMN IF NOT EXISTS shared boolean DEFAULT false NOT NULL;
