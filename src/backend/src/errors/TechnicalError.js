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
 * @class TechnicalError
 * @extends Error
 *
 * This error type is used for errors that may be presented in a
 * technical context, such as a terminal or log file.
 *
 * @todo This could be a trait errors can have rather than a class.
 */
class TechnicalError extends Error {
    constructor (message, ...details) {
        super(message);

        for ( const detail of details ) {
            detail(this);
        }
    }
}

const ERR_HINT_NOSTACK = e => {
    e.toString = () => e.message;
};

module.exports = {
    TechnicalError,
    ERR_HINT_NOSTACK,
};
