-- When the last failed digest attempt happened, so a failing watch backs off instead of blocking the queue.
ALTER TABLE watches ADD COLUMN last_attempt_at TEXT;
