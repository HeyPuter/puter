/*
 * Copyright (C) 2024 Puter Technologies Inc.
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

function fuzz_number(num) {
    // If the number is 0, then return 0
    if (num === 0) return 0;

    const magnitude = Math.floor(Math.log10(Math.abs(num)));

    let significantFigures;

    if (magnitude < 2) {             // Numbers < 100
        significantFigures = magnitude + 1;
    } else if (magnitude < 5) {      // Numbers < 100,000
        significantFigures = 2;
    } else {                        // Numbers >= 100,000
        significantFigures = 3;
    }

    const factor = Math.pow(10, magnitude - significantFigures + 1);
    return Math.round(num / factor) * factor;
}

module.exports = {
    fuzz_number
};
