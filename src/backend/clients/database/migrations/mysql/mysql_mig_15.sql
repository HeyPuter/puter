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

-- Card fingerprint column. Mirrors SQLite migration 0060. `card_fingerprint`
-- is the Stripe card fingerprint (stable per card number) recorded when a user
-- clears card verification — the card sibling of `phone`, indexed like it so
-- admin tooling can find the accounts that verified with a given card. The card
-- itself never touches our DB, only Stripe's fingerprint for it.
--
-- Idempotent: the column add uses _puter_add_col (defined in mig_1, which
-- leaves it resident for later migrations); the index add is guarded against
-- INFORMATION_SCHEMA.STATISTICS so the directory replays safely.

CALL _puter_add_col('user', 'card_fingerprint', '`card_fingerprint` varchar(128) DEFAULT NULL');

DROP PROCEDURE IF EXISTS _puter_add_user_card_fingerprint_index;
DELIMITER //
CREATE PROCEDURE _puter_add_user_card_fingerprint_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user'
      AND INDEX_NAME = 'idx_user_card_fingerprint'
  ) THEN
    ALTER TABLE `user` ADD INDEX `idx_user_card_fingerprint` (`card_fingerprint`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_user_card_fingerprint_index();

DROP PROCEDURE IF EXISTS _puter_add_user_card_fingerprint_index;
