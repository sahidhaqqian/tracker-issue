CREATE TABLE IF NOT EXISTS issues(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  requester TEXT DEFAULT '',
  priority TEXT DEFAULT 'Medium',
  deadline TEXT DEFAULT '',
  deadline_at TEXT DEFAULT '',
  status TEXT DEFAULT 'To Do',
  note TEXT DEFAULT '',
  screenshot TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT DEFAULT '',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_events_issue ON events(issue_id);
CREATE INDEX IF NOT EXISTS idx_issues_done ON issues(done_at);
CREATE TABLE IF NOT EXISTS shots(hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
