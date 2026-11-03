-- Jalankan SEKALI di Console D1 (untuk database yang sudah ada)
ALTER TABLE issues ADD COLUMN deadline_at TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_issues_done ON issues(done_at);
CREATE TABLE IF NOT EXISTS shots(hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
