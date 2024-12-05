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
class TimeUnit {
    static valueOf () {
        return this.value;
    }
}

class MILLISECOND extends TimeUnit {
    static value = 1;
}

class SECOND extends TimeUnit {
    static value = 1000 * MILLISECOND;
}

class MINUTE extends TimeUnit {
    static value = 60 * SECOND;
}

class HOUR extends TimeUnit {
    static value = 60 * MINUTE;
}

class DAY extends TimeUnit {
    static value = 24 * HOUR;
}

module.exports = {
    MILLISECOND,
    SECOND,
    MINUTE,
    HOUR,
    DAY,
};

