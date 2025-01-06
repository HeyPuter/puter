// METADATA // {"ai-commented":{"service":"claude"}}
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
module.exports = {
    // Douglas Crockford doesn't like Symbol
    // https://youtu.be/XFTOG895C7c?t=1469
    // I think for this use case his argument would
    // be "just use { label: 'DB_READ' } instead"
    // but I've been using object references like
    // that for years and it's refreshing not to
    // need to assign an arbitrary property name
    // to my debugging label.
    // This is a pretty long comment for such a small
    // file but nothing else is going to go in this
    // file so it might as well have a long comment
    // in it because if somebody is reading this file
    // they're probably looking to find some secret
    // undocumented constants and there aren't any
    // so this comment will hopefully counter-balance
    // the disappointment from that.
    DB_READ: Symbol('DB_READ'),
    DB_WRITE: Symbol('DB_WRITE'),
};
