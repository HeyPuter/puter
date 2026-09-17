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

-- See sqlite/0085_event-subscriptions-include-value.sql for the column
-- rationale. No per-file applied-state tracking, so it goes through
-- _puter_add_col as mysql_mig_39 does.

CALL _puter_add_col('event_subscriptions', 'include_value', '`include_value` tinyint(1) NOT NULL DEFAULT 0');
