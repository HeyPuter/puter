-- Extend `sessions` so a single row can represent any token kind
-- (web/app/access_token/asset), carry display metadata for the
-- manage-sessions UI, and be soft-revoked with row-level expiry.
-- Mirrors SQLite migration 0050.
--
-- Idempotent: each ADD COLUMN / ADD INDEX is guarded by an
-- INFORMATION_SCHEMA check, so re-running the migration directory
-- is safe (required — the runner has no per-file tracking).

DROP PROCEDURE IF EXISTS _puter_extend_sessions_v2;
DELIMITER //
CREATE PROCEDURE _puter_extend_sessions_v2()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'kind'
  ) THEN
    ALTER TABLE `sessions`
      ADD COLUMN `kind` ENUM('web', 'app', 'access_token', 'asset')
        NOT NULL DEFAULT 'web';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'label'
  ) THEN
    ALTER TABLE `sessions` ADD COLUMN `label` VARCHAR(255) DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'parent_session_id'
  ) THEN
    ALTER TABLE `sessions`
      ADD COLUMN `parent_session_id` VARCHAR(64) DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'last_ip'
  ) THEN
    ALTER TABLE `sessions` ADD COLUMN `last_ip` VARCHAR(64) DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'last_user_agent'
  ) THEN
    ALTER TABLE `sessions`
      ADD COLUMN `last_user_agent` VARCHAR(512) DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'revoked_at'
  ) THEN
    ALTER TABLE `sessions` ADD COLUMN `revoked_at` BIGINT DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'expires_at'
  ) THEN
    ALTER TABLE `sessions` ADD COLUMN `expires_at` BIGINT DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND INDEX_NAME = 'idx_sessions_user_revoked'
  ) THEN
    ALTER TABLE `sessions`
      ADD INDEX `idx_sessions_user_revoked` (`user_id`, `revoked_at`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND INDEX_NAME = 'idx_sessions_parent'
  ) THEN
    ALTER TABLE `sessions`
      ADD INDEX `idx_sessions_parent` (`parent_session_id`);
  END IF;
END//
DELIMITER ;

CALL _puter_extend_sessions_v2();

DROP PROCEDURE IF EXISTS _puter_extend_sessions_v2;
