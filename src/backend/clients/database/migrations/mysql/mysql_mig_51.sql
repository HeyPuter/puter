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

-- Lets a holder's grant check read only the permissions it names. Guarded, so
-- a replay does nothing.

DROP PROCEDURE IF EXISTS _puter_add_u2u_holder_permission_index;
DELIMITER //
CREATE PROCEDURE _puter_add_u2u_holder_permission_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_to_user_permissions'
      AND INDEX_NAME = 'idx_user_to_user_permissions_holder_permission'
  ) THEN
    ALTER TABLE `user_to_user_permissions` ADD INDEX `idx_user_to_user_permissions_holder_permission` (`holder_user_id`, `permission`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_u2u_holder_permission_index();

DROP PROCEDURE IF EXISTS _puter_add_u2u_holder_permission_index;
