-- Copyright (C) 2024-present Puter Technologies Inc.
--
-- This file is part of Puter.
--
-- Puter is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as published
-- by the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU Affero General Public License for more details.
--
-- You should have received a copy of the GNU Affero General Public License
-- along with this program.  If not, see <https://www.gnu.org/licenses/>.

-- Mirrors SQLite migration 0088: index `apps.index_url` for origin lookups.
-- TEXT needs a prefix; 191 characters keeps the key under 767 bytes in
-- utf8mb4 whatever the table's row format, and URLs diverge well before it.
--
-- Idempotent: the guarded procedure, as mig_36. The 1061 handler covers two
-- nodes booting at once, where the loser finds the index already built.

DROP PROCEDURE IF EXISTS _puter_add_apps_index_url_index;
DELIMITER //
CREATE PROCEDURE _puter_add_apps_index_url_index()
BEGIN
  DECLARE CONTINUE HANDLER FOR 1061 BEGIN END;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'apps'
      AND INDEX_NAME = 'idx_apps_index_url'
  ) THEN
    ALTER TABLE `apps`
      ADD INDEX `idx_apps_index_url` (`index_url`(191)),
      ALGORITHM=INPLACE, LOCK=NONE;
  END IF;
END//
DELIMITER ;

CALL _puter_add_apps_index_url_index();
DROP PROCEDURE IF EXISTS _puter_add_apps_index_url_index;
