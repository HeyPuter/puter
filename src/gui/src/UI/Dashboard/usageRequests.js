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

import shareInFlight from '../../helpers/shareInFlight.js';

// Home and Usage both show these and both load them when the dashboard
// opens; a load overlapping the other's shares its request.
export const getMonthlyUsage = shareInFlight(() => puter.auth.getMonthlyUsage());
export const getStorageSpace = shareInFlight(() => puter.fs.space());
