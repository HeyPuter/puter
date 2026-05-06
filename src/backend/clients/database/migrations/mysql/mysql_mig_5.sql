-- Copyright (C) 2024-present Puter Technologies Inc.
--
-- Add UNIQUE(app_uid, name) on `old_app_names` to mirror the SQLite
-- schema (after migration 0048) and let AppStore use ON DUPLICATE KEY
-- UPDATE to refresh the timestamp when the same app re-records the
-- same old name. The MySQL table previously had no uniqueness on these
-- columns, so we deduplicate first (keeping the most recent row per
-- (app_uid, name) pair) before adding the constraint.
--
-- Idempotent: a stored procedure inspects INFORMATION_SCHEMA before
-- adding the index, so re-running the migration directory is safe.

DROP PROCEDURE IF EXISTS _puter_dedup_old_app_names;
DELIMITER //
CREATE PROCEDURE _puter_dedup_old_app_names()
BEGIN
  DELETE oa FROM `old_app_names` oa
  JOIN `old_app_names` ob
    ON oa.`app_uid` = ob.`app_uid`
   AND oa.`name`    = ob.`name`
   AND (oa.`timestamp` < ob.`timestamp`
        OR (oa.`timestamp` = ob.`timestamp` AND oa.`id` < ob.`id`));
END//
DELIMITER ;

CALL _puter_dedup_old_app_names();

DROP PROCEDURE IF EXISTS _puter_dedup_old_app_names;

DROP PROCEDURE IF EXISTS _puter_add_unique_old_app_names;
DELIMITER //
CREATE PROCEDURE _puter_add_unique_old_app_names()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'old_app_names'
      AND INDEX_NAME   = 'unique_old_app_names_app_uid_name'
  ) THEN
    ALTER TABLE `old_app_names`
      ADD UNIQUE KEY `unique_old_app_names_app_uid_name` (`app_uid`, `name`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_unique_old_app_names();

DROP PROCEDURE IF EXISTS _puter_add_unique_old_app_names;
