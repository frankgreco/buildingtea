-- BuildingTea schema. Four concerns: computed reports, who paid for what, which
-- buildings are being watched, and the access tokens that unlock a report.
-- No user table on purpose: the purchase is the identity and the token is the credential.

CREATE TABLE reports (
  id            TEXT PRIMARY KEY,                 -- public, unguessable, not secret
  bin           TEXT NOT NULL,
  bbl           TEXT NOT NULL,
  unit          TEXT,
  address_label TEXT NOT NULL,
  report_json   TEXT NOT NULL,                    -- full Report (see shared/types.ts)
  teaser_json   TEXT NOT NULL,                    -- Teaser (what the unpaid page sees)
  generated_at  TEXT NOT NULL,                    -- ISO timestamp of the upstream fetch
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX reports_bin_generated ON reports (bin, generated_at DESC);

CREATE TABLE purchases (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id          TEXT NOT NULL REFERENCES reports(id),
  stripe_session_id  TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  email              TEXT,
  status             TEXT NOT NULL CHECK (status IN ('pending','paid','failed')),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at            TEXT
);
CREATE INDEX purchases_report ON purchases (report_id);

CREATE TABLE watches (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id              TEXT NOT NULL REFERENCES reports(id),
  bin                    TEXT NOT NULL,
  bbl                    TEXT NOT NULL,
  unit                   TEXT,
  address_label          TEXT NOT NULL,
  email                  TEXT NOT NULL,
  stripe_customer_id     TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  status                 TEXT NOT NULL CHECK (status IN ('active','past_due','canceled')),
  last_snapshot_json     TEXT,                    -- WatchSnapshot used for the nightly diff
  last_checked_at        TEXT,
  last_alert_at          TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX watches_status ON watches (status);
CREATE INDEX watches_bin ON watches (bin);

-- A report can have several valid tokens (one per emailed link). Only the SHA-256
-- of each token is stored, so a database leak does not leak working links.
CREATE TABLE access_tokens (
  token_hash  TEXT PRIMARY KEY,
  report_id   TEXT NOT NULL REFERENCES reports(id),
  kind        TEXT NOT NULL CHECK (kind IN ('purchase','watch')),
  purchase_id INTEGER REFERENCES purchases(id),
  watch_id    INTEGER REFERENCES watches(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX access_tokens_report ON access_tokens (report_id);

-- Stripe delivers webhooks at least once. Record each event id so a redelivery is a no-op.
CREATE TABLE stripe_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
