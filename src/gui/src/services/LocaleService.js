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
import { Service } from "../definitions.js";
import i18n from "../i18n/i18n.js";

export class LocaleService extends Service {
    format_duration (seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        // Padding each value to ensure it always has two digits
        const paddedHours = hours.toString().padStart(2, '0');
        const paddedMinutes = minutes.toString().padStart(2, '0');
        const paddedSeconds = remainingSeconds.toString().padStart(2, '0');

        if (hours === 0 && minutes === 0) {
            return `${paddedSeconds} ${i18n('seconds')}`;
        }

        if (hours === 0) {
            return `${paddedMinutes}:${paddedSeconds}`;
        }

        return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
    }
}
