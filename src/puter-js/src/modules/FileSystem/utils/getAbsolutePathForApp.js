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
import path from "../../../lib/path.js"

const getAbsolutePathForApp = (relativePath)=>{
    // if we are in the gui environment, return the relative path as is
    if(puter.env === 'gui')
        return relativePath;

    // if no relative path is provided, use the current working directory
    if(!relativePath)
        relativePath = '.';

    // If relativePath is not provided, or it's not starting with a slash or tilde,
    // it means it's a relative path. In that case, prepend the app's root directory.
    if (!relativePath || (!relativePath.startsWith('/') && !relativePath.startsWith('~') && puter.appID)) {
        relativePath = path.join('~/AppData', puter.appID, relativePath);
    }

    return relativePath;
}

export default getAbsolutePathForApp;