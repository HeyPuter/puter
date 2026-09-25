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
-- `app_uid` is varchar(40) — the width of `apps`.`uid` — and varchar rather
-- than char for the same reason `uid` is here: blank padding is not what the
-- column means.
--
-- Idempotent via IF NOT EXISTS and the `type = ''` guard on the backfill.

ALTER TABLE notification ADD COLUMN IF NOT EXISTS app_uid varchar(40);
ALTER TABLE notification ADD COLUMN IF NOT EXISTS audience varchar(16) NOT NULL DEFAULT 'account';
ALTER TABLE notification ADD COLUMN IF NOT EXISTS type varchar(64) NOT NULL DEFAULT '';

-- Serves both the scoped list and the unacknowledged count.
CREATE INDEX IF NOT EXISTS idx_notification_scope
    ON notification (user_id, audience, app_uid, acknowledged);

UPDATE notification
SET type = 'share.received', audience = 'account', app_uid = NULL
WHERE type = ''
  AND value->>'template' = 'file-shared-with-you';

UPDATE notification
SET type = 'share.claimed', audience = 'account', app_uid = NULL
WHERE type = ''
  AND value->>'template' = 'file-shared-before-you-joined';

-- Worker rows carried only `source: 'worker'` and a title, so the app they
-- belong to is unrecoverable and they stay unattributed. The title prefix is
-- the sole surviving signal of which way the deploy went.
UPDATE notification
SET audience = 'developer',
    app_uid = NULL,
    type = CASE
      WHEN value->>'title' LIKE 'Successfully deployed %'
        THEN 'app.worker.deployed'
      ELSE 'app.worker.deployFailed'
    END
WHERE type = ''
  AND value->>'source' = 'worker';
