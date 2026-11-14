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

-- `user`.`signup_tls_fingerprint`. See
-- sqlite/0104_signup-tls-fingerprint.sql for the rationale. No per-file
-- applied-state tracking, so the column and index are added only when missing
-- and a replay does nothing.

DROP PROCEDURE IF EXISTS _puter_add_user_signup_tls_fingerprint;
DELIMITER //
CREATE PROCEDURE _puter_add_user_signup_tls_fingerprint()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user'
      AND COLUMN_NAME = 'signup_tls_fingerprint'
  ) THEN
    ALTER TABLE `user`
      ADD COLUMN `signup_tls_fingerprint` varchar(64) DEFAULT NULL,
      ALGORITHM=INSTANT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user'
      AND INDEX_NAME = 'idx_user_signup_tls_fingerprint'
  ) THEN
    ALTER TABLE `user` ADD INDEX `idx_user_signup_tls_fingerprint`
      (`signup_tls_fingerprint`), ALGORITHM=INPLACE, LOCK=NONE;
  END IF;
END//
DELIMITER ;

CALL _puter_add_user_signup_tls_fingerprint();

DROP PROCEDURE IF EXISTS _puter_add_user_signup_tls_fingerprint;
