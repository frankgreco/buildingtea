-- Monthly watch digest: when the last digest email went out (NULL until the first, which is due 30 days after created_at).
ALTER TABLE watches ADD COLUMN last_digest_at TEXT;
