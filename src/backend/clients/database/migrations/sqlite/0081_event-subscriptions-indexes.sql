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

-- `event_subscriptions` grew three hot queries with no index behind them:
--
--   - `(app_uid, handler_name)`  : a handler's own rows (`listByHandler`) —
--                                  suspending/resuming everything one
--                                  publish or removal touches.
--   - `(expires_at)`             : the expiry reaper's sweep.
--   - `(suspended_at, id)`       : the suspended reaper's sweep. The range on
--                                  `suspended_at` is the win; `id` only keeps
--                                  the reaper's keyset page off the table.

CREATE INDEX IF NOT EXISTS `idx_event_subscriptions_app_handler`
    ON `event_subscriptions` (`app_uid`, `handler_name`);

CREATE INDEX IF NOT EXISTS `idx_event_subscriptions_expires`
    ON `event_subscriptions` (`expires_at`);

CREATE INDEX IF NOT EXISTS `idx_event_subscriptions_suspended`
    ON `event_subscriptions` (`suspended_at`, `id`);
