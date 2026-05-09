CREATE TABLE IF NOT EXISTS call_comparison_scripts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS call_comparison_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  script_id TEXT,
  name TEXT NOT NULL,
  source_type TEXT,
  source_path TEXT,
  source_loaded_at TEXT,
  summary TEXT,
  average_score INTEGER,
  good_count INTEGER NOT NULL DEFAULT 0,
  bad_count INTEGER NOT NULL DEFAULT 0,
  analyzed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (script_id) REFERENCES call_comparison_scripts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS call_recordings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT,
  status TEXT NOT NULL DEFAULT 'Pendente',
  is_transcribed INTEGER NOT NULL DEFAULT 0,
  raw_transcript TEXT,
  speaker_transcript TEXT,
  transcript_summary TEXT,
  analysis TEXT,
  comparison_summary TEXT,
  score INTEGER,
  is_good INTEGER,
  error TEXT,
  transcribed_at TEXT,
  analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES call_comparison_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_call_scripts_user_updated ON call_comparison_scripts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_groups_user_updated ON call_comparison_groups(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_recordings_group_updated ON call_recordings(group_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_recordings_user_status ON call_recordings(user_id, status);
