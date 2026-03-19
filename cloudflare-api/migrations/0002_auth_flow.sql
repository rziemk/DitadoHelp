ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN ui_language TEXT NOT NULL DEFAULT 'pt';

CREATE TABLE IF NOT EXISTS auth_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  session_token TEXT,
  session_expires_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE magic_links ADD COLUMN auth_request_id TEXT REFERENCES auth_requests(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_auth_requests_user_id ON auth_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_requests_status ON auth_requests(status);
