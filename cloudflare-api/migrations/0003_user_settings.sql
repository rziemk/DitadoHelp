CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  llm_provider TEXT,
  stt_model TEXT,
  llm_model TEXT,
  translation_lang TEXT,
  same_key INTEGER NOT NULL DEFAULT 1,
  use_free_fallback INTEGER NOT NULL DEFAULT 1,
  append_dictation INTEGER NOT NULL DEFAULT 0,
  ui_language TEXT NOT NULL DEFAULT 'pt',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_secrets (
  user_id TEXT PRIMARY KEY,
  stt_key_encrypted TEXT,
  llm_key_encrypted TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
