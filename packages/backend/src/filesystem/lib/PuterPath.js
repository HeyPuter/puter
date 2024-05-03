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
const _path = require('path');

/**
 * Puter paths look like any of the following:
 * 
 * Absolute path: /user/dir1/dir2/file
 * From UID: AAAA-BBBB-CCCC-DDDD/../a/b/c
 * 
 * The difference between an absolute path and a UID-relative path
 * is the leading forward-slash character.
 */
class PuterPath {
    static NULL_UUID = '00000000-0000-0000-0000-000000000000';

    static adapt (value) {
        if ( value instanceof PuterPath ) return value;
        return new PuterPath(value);
    }

    constructor (text) {
        this.text = text;
    }

    set text (text) {
        this.text_ = text.trim();
        this.normUnix = _path.normalize(text);
        this.normFlat =
            (this.normUnix.endsWith('/') && this.normUnix.length > 1)
            ? this.normUnix.slice(0, -1) : this.normUnix;
    }
    get text () { return this.text_; }

    isRoot () {
        if ( this.normFlat === '/' ) return true;
        if ( this.normFlat === this.constructor.NULL_UUID ) {
            return true;
        }
        return false;
    }

    isAbsolute () {
        return this.text.startsWith('/');
    }

    isFromUID () {
        return ! this.isAbsolute();
    }

    get reference () {
        if ( this.isAbsolute ) return this.constructor.NULL_UUID;

        return this.text.slice(0, this.text.indexOf('/'));
    }

    get relativePortion () {
        if ( this.isAbsolute() ) {
            return this.text.slice(1);
        }

        if ( ! this.text.includes('/') ) return '';
        return this.text.slice(this.text.indexOf('/') + 1);
    }
}

module.exports = { PuterPath };
