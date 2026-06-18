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

-- SMS phone verification columns. Mirrors SQLite migration 0058. `phone` is the
-- E.164 number collected during verification (indexed like `email`);
-- `requires_phone_verification` gates account use for low-reputation signups
-- (not indexed, mirroring `requires_email_confirmation`).
--
-- Idempotent: column adds use _puter_add_col (defined in mig_1, which leaves it
-- resident for later migrations); the index add is guarded against
-- INFORMATION_SCHEMA.STATISTICS so the directory replays safely.

CALL _puter_add_col('user', 'phone', '`phone` varchar(20) DEFAULT NULL');
CALL _puter_add_col('user', 'requires_phone_verification', '`requires_phone_verification` tinyint(1) NOT NULL DEFAULT ''0''');

DROP PROCEDURE IF EXISTS _puter_add_user_phone_index;
DELIMITER //
CREATE PROCEDURE _puter_add_user_phone_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user'
      AND INDEX_NAME = 'idx_user_phone'
  ) THEN
    ALTER TABLE `user` ADD INDEX `idx_user_phone` (`phone`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_user_phone_index();

DROP PROCEDURE IF EXISTS _puter_add_user_phone_index;
