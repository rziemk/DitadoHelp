ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;

UPDATE users
SET email_verified_at = COALESCE(email_verified_at, last_login_at, updated_at)
WHERE email_verified_at IS NULL AND last_login_at IS NOT NULL;

ALTER TABLE user_settings ADD COLUMN auto_sync_cloud INTEGER NOT NULL DEFAULT 1;
