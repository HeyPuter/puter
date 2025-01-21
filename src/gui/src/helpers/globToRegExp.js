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

/* globToRegExp is derived from: https://github.com/fitzgen/glob-to-regexp
 *
 * Copyright (c) 2013, Nick Fitzgerald All rights reserved.
 * See full license text here: https://github.com/fitzgen/glob-to-regexp#license
 */


/**
 * Converts a glob pattern to a regular expression, with optional extended or globstar matching.
 *
 * @param {string} glob - The glob pattern to convert.
 * @param {Object} [opts] - Optional options for the conversion.
 * @param {boolean} [opts.extended=false] - If true, enables extended matching with single character matching, character ranges, group matching, etc.
 * @param {boolean} [opts.globstar=false] - If true, uses globstar matching, where '*' matches zero or more path segments.
 * @param {string} [opts.flags] - Regular expression flags to include (e.g., 'i' for case-insensitive).
 * @returns {RegExp} The generated regular expression.
 * @throws {TypeError} If the provided glob pattern is not a string.
 */
const globToRegExp = function (glob, opts) {
    if (typeof glob !== 'string') {
        throw new TypeError('Expected a string');
    }

    var str = String(glob);

    // The regexp we are building, as a string.
    var reStr = "";

    // Whether we are matching so called "extended" globs (like bash) and should
    // support single character matching, matching ranges of characters, group
    // matching, etc.
    var extended = opts ? !!opts.extended : false;

    // When globstar is _false_ (default), '/foo/*' is translated a regexp like
    // '^\/foo\/.*$' which will match any string beginning with '/foo/'
    // When globstar is _true_, '/foo/*' is translated to regexp like
    // '^\/foo\/[^/]*$' which will match any string beginning with '/foo/' BUT
    // which does not have a '/' to the right of it.
    // E.g. with '/foo/*' these will match: '/foo/bar', '/foo/bar.txt' but
    // these will not '/foo/bar/baz', '/foo/bar/baz.txt'
    // Lastely, when globstar is _true_, '/foo/**' is equivelant to '/foo/*' when
    // globstar is _false_
    var globstar = opts ? !!opts.globstar : false;

    // If we are doing extended matching, this boolean is true when we are inside
    // a group (eg {*.html,*.js}), and false otherwise.
    var inGroup = false;

    // RegExp flags (eg "i" ) to pass in to RegExp constructor.
    var flags = opts && typeof (opts.flags) === "string" ? opts.flags : "";

    var c;
    for (var i = 0, len = str.length; i < len; i++) {
        c = str[i];

        switch (c) {
            case "/":
            case "$":
            case "^":
            case "+":
            case ".":
            case "(":
            case ")":
            case "=":
            case "!":
            case "|":
                reStr += "\\" + c;
                break;

            case "?":
                if (extended) {
                    reStr += ".";
                    break;
                }
                // fallthrough

            case "[":
            case "]":
                if (extended) {
                    reStr += c;
                    break;
                }
                // fallthrough

            case "{":
                if (extended) {
                    inGroup = true;
                    reStr += "(";
                    break;
                }
                // fallthrough

            case "}":
                if (extended) {
                    inGroup = false;
                    reStr += ")";
                    break;
                }
                // fallthrough

            case ",":
                if (inGroup) {
                    reStr += "|";
                    break;
                }
                reStr += "\\" + c;
                break;

            case "*":
                // Move over all consecutive "*"'s.
                // Also store the previous and next characters
                var prevChar = str[i - 1];
                var starCount = 1;
                while (str[i + 1] === "*") {
                    starCount++;
                    i++;
                }
                var nextChar = str[i + 1];

                if (!globstar) {
                    // globstar is disabled, so treat any number of "*" as one
                    reStr += ".*";
                } else {
                    // globstar is enabled, so determine if this is a globstar segment
                    var isGlobstar = starCount > 1                      // multiple "*"'s
                        && (prevChar === "/" || prevChar === undefined)   // from the start of the segment
                        && (nextChar === "/" || nextChar === undefined)   // to the end of the segment

                    if (isGlobstar) {
                        // it's a globstar, so match zero or more path segments
                        reStr += "((?:[^/]*(?:/|$))*)";
                        i++; // move over the "/"
                    } else {
                        // it's not a globstar, so only match one path segment
                        reStr += "([^/]*)";
                    }
                }
                break;

            default:
                reStr += c;
        }
    }

    // When regexp 'g' flag is specified don't
    // constrain the regular expression with ^ & $
    if (!flags || !~flags.indexOf('g')) {
        reStr = "^" + reStr + "$";
    }

    return new RegExp(reStr, flags);
};
  

export default globToRegExp;