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

-- One user refusing contact from another. See sqlite/0068_user-block.sql for
-- the rationale. `created_at` is unix seconds.
--
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS user_block (
    id BIGSERIAL PRIMARY KEY,
    blocker_user_id integer NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE ON UPDATE CASCADE,
    blocked_user_id integer NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_block_pair
    ON user_block (blocker_user_id, blocked_user_id);
