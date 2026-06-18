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
--
-- Idempotent: the ADD COLUMN is guarded by an INFORMATION_SCHEMA check,
-- so re-running the migration directory is safe (required — the runner
-- has no per-file tracking).

DROP PROCEDURE IF EXISTS _puter_add_subdomains_preamble_version;
DELIMITER //
CREATE PROCEDURE _puter_add_subdomains_preamble_version()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'subdomains' AND COLUMN_NAME = 'preamble_version'
  ) THEN
    ALTER TABLE `subdomains`
      ADD COLUMN `preamble_version` varchar(64) DEFAULT NULL;
  END IF;
END//
DELIMITER ;

CALL _puter_add_subdomains_preamble_version();

DROP PROCEDURE IF EXISTS _puter_add_subdomains_preamble_version;
