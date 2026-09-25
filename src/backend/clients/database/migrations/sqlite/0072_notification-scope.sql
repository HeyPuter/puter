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

-- Scope tuple for `notification`. See mysql/mysql_mig_26.sql for the rationale.
--
-- Done as the standard 12-step rebuild rather than three ALTERs, because the
-- same table is missing two things mysql and postgres have had since the v1
-- schema: an index on `user_id`, which every `listByUserId` scans without, and
-- the cascade that retires a deleted user's rows. A column add cannot
-- introduce a foreign key here.
--
-- Rows whose user is already gone are dropped rather than carried over: the
-- cascade this migration adds is what would have removed them.
--
-- Wrapped in one transaction: without it, a crash between the `DROP` and the
-- `RENAME` below would lose the table outright rather than leave it
-- unmigrated. `IF EXISTS`/`IF NOT EXISTS` guard a stale `notification_new`
-- from a previous interrupted attempt.

BEGIN;

DROP TABLE IF EXISTS `notification_new`;

CREATE TABLE `notification_new` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "uid" TEXT NOT NULL UNIQUE,
    "value" JSON NOT NULL,
    "acknowledged" INTEGER DEFAULT NULL,
    "shown" INTEGER DEFAULT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "app_uid" TEXT DEFAULT NULL,
    "audience" TEXT NOT NULL DEFAULT 'account',
    "type" TEXT NOT NULL DEFAULT '',
    FOREIGN KEY("user_id") REFERENCES `user` ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO `notification_new` (
    `id`, `user_id`, `uid`, `value`, `acknowledged`, `shown`, `created_at`
)
SELECT
    `id`, `user_id`, `uid`, `value`, `acknowledged`, `shown`, `created_at`
FROM `notification`
WHERE `user_id` IN (SELECT `id` FROM `user`);

DROP TABLE IF EXISTS `notification`;

ALTER TABLE `notification_new` RENAME TO `notification`;

CREATE INDEX IF NOT EXISTS `idx_notification_user_id`
    ON `notification` (`user_id`);

-- Serves both the scoped list and the unacknowledged count.
CREATE INDEX IF NOT EXISTS `idx_notification_scope`
    ON `notification` (`user_id`, `audience`, `app_uid`, `acknowledged`);

-- Backfill from the markers the payload actually carried. `type = ''` is the
-- not-yet-classified state, so a re-run matches nothing the first pass
-- claimed, and a row matching no marker keeps the defaults (`''` / 'account')
-- and reads as legacy. `json_valid` guards rows whose `value` was stored as a
-- bare string.

UPDATE `notification`
SET `type` = 'share.received', `audience` = 'account', `app_uid` = NULL
WHERE `type` = ''
  AND json_valid(`value`)
  AND json_extract(`value`, '$.template') = 'file-shared-with-you';

UPDATE `notification`
SET `type` = 'share.claimed', `audience` = 'account', `app_uid` = NULL
WHERE `type` = ''
  AND json_valid(`value`)
  AND json_extract(`value`, '$.template') = 'file-shared-before-you-joined';

-- Worker rows carried only `source: 'worker'` and a title, so the app they
-- belong to is unrecoverable and they stay unattributed. The title prefix is
-- the sole surviving signal of which way the deploy went.
UPDATE `notification`
SET `audience` = 'developer',
    `app_uid` = NULL,
    `type` = CASE
      WHEN json_extract(`value`, '$.title') LIKE 'Successfully deployed %'
        THEN 'app.worker.deployed'
      ELSE 'app.worker.deployFailed'
    END
WHERE `type` = ''
  AND json_valid(`value`)
  AND json_extract(`value`, '$.source') = 'worker';

COMMIT;
