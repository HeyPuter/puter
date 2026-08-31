/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Which home region an account's data belongs in.
 *
 * A home region is a node id, not a storage region: `IConfig.servers` maps one
 * to the bucket that holds it. The ids are the same ones `config.serverId` and
 * `user.signup_server` already use, so no translation is needed between them.
 */

/** Where an account's data belongs when nothing else says otherwise. */
export const DEFAULT_HOME_REGION = 'oregon';

/**
 * An account's own `home`, else the server that served its signup, else the
 * deployment default. Empty strings count as unset: a blank column is not a
 * region.
 */
export const resolveHomeRegion = (user: {
    home?: string | null;
    signup_server?: string | null;
}): string => user.home || user.signup_server || DEFAULT_HOME_REGION;
