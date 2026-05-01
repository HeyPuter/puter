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

PRAGMA foreign_keys = OFF;

CREATE TABLE user_to_app_permissions_new (
  user_id     INTEGER NOT NULL,
  app_id      INTEGER NOT NULL,
  permission  VARCHAR(255) NOT NULL,
  extra       JSON DEFAULT NULL,
  dt          DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (app_id)  REFERENCES apps(id) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (user_id, app_id, permission)
);

INSERT INTO user_to_app_permissions_new (user_id, app_id, permission, extra, dt)
SELECT user_id, app_id, permission, extra, NULL
FROM user_to_app_permissions;

DROP TABLE user_to_app_permissions;
ALTER TABLE user_to_app_permissions_new RENAME TO user_to_app_permissions;

PRAGMA foreign_keys = ON;