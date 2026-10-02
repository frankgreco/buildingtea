-- The recurring price as shown at checkout (e.g. "$3.00"), kept so the monthly digest can restate the terms.
ALTER TABLE watches ADD COLUMN price_label TEXT;
