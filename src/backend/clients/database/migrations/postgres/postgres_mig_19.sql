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

-- `event_subscriptions.anchor_uid` was sized for a filesystem node uuid. A
-- key-value subscription anchors on an app instead, and an app uid is 40
-- characters. See mysql/mysql_mig_29.sql.
--
-- Idempotent: widening to the same type is a no-op.

ALTER TABLE event_subscriptions
    ALTER COLUMN anchor_uid TYPE VARCHAR(40);
