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

-- Mirrors SQLite migration 0086: `subdomains.app_owner` cascades on app
-- delete instead of nulling. The existing constraint is found by column
-- rather than by name, since an older database need not carry the name
-- mysql_mig_1 declares. Guarded procedure as mysql_mig_34: a replay sees
-- DELETE_RULE already CASCADE and does nothing.

DROP PROCEDURE IF EXISTS _puter_subdomains_app_owner_cascade;

DELIMITER //
CREATE PROCEDURE _puter_subdomains_app_owner_cascade()
BEGIN
  DECLARE fk_name VARCHAR(64) DEFAULT NULL;

  -- A subquery, not SELECT ... INTO: no matching row yields NULL quietly.
  SET fk_name = (
    SELECT rc.CONSTRAINT_NAME
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
       AND kcu.CONSTRAINT_NAME   = rc.CONSTRAINT_NAME
       AND kcu.TABLE_NAME        = rc.TABLE_NAME
     WHERE rc.CONSTRAINT_SCHEMA      = DATABASE()
       AND rc.TABLE_NAME             = 'subdomains'
       AND rc.REFERENCED_TABLE_NAME  = 'apps'
       AND kcu.COLUMN_NAME           = 'app_owner'
       AND rc.DELETE_RULE           <> 'CASCADE'
     LIMIT 1
  );

  IF fk_name IS NOT NULL THEN
    SET @s := CONCAT('ALTER TABLE `subdomains` DROP FOREIGN KEY `', fk_name, '`');
    PREPARE stmt FROM @s;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
       AND kcu.CONSTRAINT_NAME   = rc.CONSTRAINT_NAME
       AND kcu.TABLE_NAME        = rc.TABLE_NAME
     WHERE rc.CONSTRAINT_SCHEMA      = DATABASE()
       AND rc.TABLE_NAME             = 'subdomains'
       AND rc.REFERENCED_TABLE_NAME  = 'apps'
       AND kcu.COLUMN_NAME           = 'app_owner'
       AND rc.DELETE_RULE            = 'CASCADE'
  ) THEN
    ALTER TABLE `subdomains` ADD CONSTRAINT `fk_subdomains_app_owner`
      FOREIGN KEY (`app_owner`) REFERENCES `apps` (`id`)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END//
DELIMITER ;

CALL _puter_subdomains_app_owner_cascade();
DROP PROCEDURE IF EXISTS _puter_subdomains_app_owner_cascade;
