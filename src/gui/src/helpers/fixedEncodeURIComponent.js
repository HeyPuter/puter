/**
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
 * Encodes a URI component with enhanced safety by replacing characters 
 * that are not typically encoded by the standard encodeURIComponent.
 *
 * @param {string} str - The string to be URI encoded.
 * @returns {string} - Returns the URI encoded string.
 *
 * @example
 * const str = "Hello, world!";
 * const encodedStr = fixedEncodeURIComponent(str);
 * console.log(encodedStr);  // Expected output: "Hello%2C%20world%21"
 */
const fixedEncodeURIComponent = (str)=>{
    return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
        return '%' + c.charCodeAt(0).toString(16);
    });
}

export default fixedEncodeURIComponent;