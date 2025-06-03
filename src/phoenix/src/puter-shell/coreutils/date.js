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
import { Exit } from './coreutil_lib/exit.js';

// "When no formatting operand is specified, the output in the POSIX locale shall be equivalent to specifying:"
const DEFAULT_FORMAT = '+%a %b %e %H:%M:%S %Z %Y';

function padStart(number, length, padChar) {
    let string = number.toString();
    if ( string.length >= length ) {
        return string;
    }

    return padChar.repeat(length - string.length) + string;
}

function highlight(text) {
    return `\x1B[92m${text}\x1B[0m`;
}

export default {
    name: 'date',
    usage: 'date [OPTIONS] [+FORMAT]',
    description: 'Print the system date and time\n\n' +
        'If FORMAT is provided, it controls the date format used.',
    helpSections: {
        'Format Sequences': 'The following format sequences are understood:\n\n' +
            `    ${highlight('%a')}     Weekday name, abbreviated.\n` +
            `    ${highlight('%A')}     Weekday name\n` +
            `    ${highlight('%b')}     Month name, abbreviated\n` +
            `    ${highlight('%B')}     Month name\n` +
            `    ${highlight('%c')}     Default date and time representation\n` +
            `    ${highlight('%C')}     Century, 2 digits padded with '0'\n` +
            `    ${highlight('%d')}     Day of the month, 2 digits padded with '0'\n` +
            `    ${highlight('%D')}     Date in the format mm/dd/yy\n` +
            `    ${highlight('%e')}     Day of the month, 2 characters padded with leading spaces\n` +
            `    ${highlight('%h')}     Same as ${highlight('%b')}\n` +
            `    ${highlight('%H')}     Hour (24-hour clock), 2 digits padded with '0'\n` +
            `    ${highlight('%I')}     Hour (12-hour clock), 2 digits padded with '0'\n` +
            // `    ${highlight('%j')}     TODO: Day of the year, 3 digits padded with '0'\n` +
            `    ${highlight('%m')}     Month, 2 digits padded with '0', with January = 01\n` +
            `    ${highlight('%M')}     Minutes, 2 digits padded with '0'\n` +
            `    ${highlight('%n')}     A newline character\n` +
            `    ${highlight('%p')}     AM or PM\n` +
            `    ${highlight('%r')}     Time (12-hour clock) with AM/PM, as 'HH:MM:SS AM/PM'\n` +
            `    ${highlight('%S')}     Seconds, 2 digits padded with '0'\n` +
            `    ${highlight('%t')}     A tab character\n` +
            `    ${highlight('%T')}     Time (24-hour clock), as 'HH:MM:SS'\n` +
            `    ${highlight('%u')}     Weekday as a number, with Monday = 1 and Sunday = 7\n` +
            // `    ${highlight('%U')}     TODO: Week of the year (Sunday as the first day of the week) as a decimal number [00,53]. All days in a new year preceding the first Sunday shall be considered to be in week 0.\n` +
            // `    ${highlight('%V')}     TODO: Week of the year (Monday as the first day of the week) as a decimal number [01,53]. If the week containing January 1 has four or more days in the new year, then it shall be considered week 1; otherwise, it shall be the last week of the previous year, and the next week shall be week 1.\n` +
            `    ${highlight('%w')}     Weekday as a number, with Sunday = 0\n` +
            // `    ${highlight('%W')}     TODO: Week of the year (Monday as the first day of the week) as a decimal number [00,53]. All days in a new year preceding the first Monday shall be considered to be in week 0.\n` +
            `    ${highlight('%x')}     Default date representation\n` +
            `    ${highlight('%X')}     Default time representation\n` +
            `    ${highlight('%y')}     Year within century, 2 digits padded with '0'\n` +
            `    ${highlight('%Y')}     Year\n` +
            `    ${highlight('%Z')}     Timezone name, if it can be determined\n` +
            `    ${highlight('%%')}     A percent sign\n`
    },
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            utc: {
                description: 'Operate in UTC instead of the local timezone',
                type: 'boolean',
                short: 'u',
                default: false,
            }
        }
    },
    execute: async ctx => {
        const { out, err } = ctx.externs;
        const { positionals, values } = ctx.locals;

        if ( positionals.length > 1 ) {
            await err.write('date: Too many arguments\n');
            throw new Exit(1);
        }

        let format = positionals.shift() ?? DEFAULT_FORMAT;

        if ( ! format.startsWith('+') ) {
            await err.write('date: Format does not begin with `+`\n');
            throw new Exit(1);
        }
        format = format.substring(1);

        // TODO: Should we use the server time instead? Maybe put that behind an option.
        const date = new Date();
        const locale = 'en-US'; // TODO: POSIX: Pull this from the user's settings.
        const timeZone = values.utc ? 'UTC' : undefined;

        // Helper functions to get date/time values respecting UTC option
        const getYear = () => values.utc ? date.getUTCFullYear() : date.getFullYear();
        const getMonth = () => values.utc ? date.getUTCMonth() : date.getMonth();
        const getDate = () => values.utc ? date.getUTCDate() : date.getDate();
        const getDay = () => values.utc ? date.getUTCDay() : date.getDay();
        const getHours = () => values.utc ? date.getUTCHours() : date.getHours();
        const getMinutes = () => values.utc ? date.getUTCMinutes() : date.getMinutes();
        const getSeconds = () => values.utc ? date.getUTCSeconds() : date.getSeconds();

        let output = '';
        for (let i = 0; i < format.length; i++) {
            let char = format[i];
            if ( char === '%' ) {
                char = format[++i];
                switch (char) {
                    // "Locale's abbreviated weekday name."
                    case 'a': {
                        output += date.toLocaleDateString(locale, { timeZone: timeZone, weekday: 'short' });
                        break;
                    }

                    // "Locale's full weekday name."
                    case 'A': {
                        output += date.toLocaleDateString(locale, { timeZone: timeZone, weekday: 'long' });
                        break;
                    }

                    // b: "Locale's abbreviated month name."
                    // h: "A synonym for %b."
                    case 'b':
                    case 'h': {
                        output += date.toLocaleDateString(locale, { timeZone: timeZone, month: 'short' });
                        break;
                    }

                    // "Locale's full month name."
                    case 'B': {
                        output += date.toLocaleDateString(locale, { timeZone: timeZone, month: 'long' });
                        break;
                    }

                    // "Locale's appropriate date and time representation."
                    case 'c':  {
                        output += date.toLocaleString(locale, { timeZone: timeZone });
                        break;
                    }

                    // "Century (a year divided by 100 and truncated to an integer) as a decimal number [00,99]."
                    case 'C': {
                        output += Math.trunc(getYear() / 100);
                        break;
                    }

                    // "Day of the month as a decimal number [01,31]."
                    case 'd': {
                        output += padStart(getDate(), 2, '0');
                        break;
                    }

                    // "Date in the format mm/dd/yy."
                    case 'D': {
                        const month = padStart(getMonth() + 1, 2, '0');
                        const day = padStart(getDate(), 2, '0');
                        const year = padStart(getYear() % 100, 2, '0');
                        output += `${month}/${day}/${year}`;
                        break;
                    }

                    // "Day of the month as a decimal number [1,31] in a two-digit field with leading <space>
                    // character fill."
                    case 'e': {
                        output += padStart(getDate(), 2, ' ');
                        break;
                    }

                    // "Hour (24-hour clock) as a decimal number [00,23]."
                    case 'H': {
                        output += padStart(getHours(), 2, '0');
                        break;
                    }

                    // "Hour (12-hour clock) as a decimal number [01,12]."
                    case 'I': {
                        output += padStart((getHours() % 12) || 12, 2, '0');
                        break;
                    }

                    // TODO: "Day of the year as a decimal number [001,366]."
                    case 'j': break;

                    // "Month as a decimal number [01,12]."
                    case 'm': {
                        // getMonth() starts at 0 for January
                        output += padStart(getMonth() + 1, 2, '0');
                        break;
                    }

                    // "Minute as a decimal number [00,59]."
                    case 'M': {
                        output += padStart(getMinutes(), 2, '0');
                        break;
                    }

                    // "A <newline>."
                    case 'n': output += '\n'; break;

                    // "Locale's equivalent of either AM or PM."
                    case 'p': {
                        // TODO: We should access this from the locale.
                        output += getHours() < 12 ? 'AM' : 'PM';
                        break;
                    }

                    // "12-hour clock time [01,12] using the AM/PM notation; in the POSIX locale, this shall be
                    // equivalent to %I : %M : %S %p."
                    case 'r': {
                        const rawHours = getHours();
                        const hours = padStart((rawHours % 12) || 12, 2, '0');
                        // TODO: We should access this from the locale.
                        const am_pm = rawHours < 12 ? 'AM' : 'PM';
                        const minutes = padStart(getMinutes(), 2, '0');
                        const seconds = padStart(getSeconds(), 2, '0');
                        output += `${hours}:${minutes}:${seconds} ${am_pm}`;
                        break;
                    }

                    // "Seconds as a decimal number [00,60]."
                    case 'S': {
                        output += padStart(getSeconds(), 2, '0');
                        break;
                    }

                    // "A <tab>."
                    case 't': output += '\t'; break;

                    // "24-hour clock time [00,23] in the format HH:MM:SS."
                    case 'T': {
                        const hours = padStart(getHours(), 2, '0');
                        const minutes = padStart(getMinutes(), 2, '0');
                        const seconds = padStart(getSeconds(), 2, '0');
                        output += `${hours}:${minutes}:${seconds}`;
                        break;
                    }

                    // "Weekday as a decimal number [1,7] (1=Monday)."
                    case 'u': {
                        // getDay() returns 0 for Sunday
                        output += getDay() || 7;
                        break;
                    }

                    // TODO: "Week of the year (Sunday as the first day of the week) as a decimal number [00,53].
                    //       All days in a new year preceding the first Sunday shall be considered to be in week 0."
                    case 'U': break;

                    // TODO: "Week of the year (Monday as the first day of the week) as a decimal number [01,53].
                    //       If the week containing January 1 has four or more days in the new year, then it shall be
                    //       considered week 1; otherwise, it shall be the last week of the previous year, and the next
                    //       week shall be week 1."
                    case 'V': break;

                    // "Weekday as a decimal number [0,6] (0=Sunday)."
                    case 'w': {
                        output += getDay();
                        break;
                    }

                    // TODO: "Week of the year (Monday as the first day of the week) as a decimal number [00,53].
                    //       All days in a new year preceding the first Monday shall be considered to be in week 0."
                    case 'W': break;

                    // "Locale's appropriate date representation."
                    case 'x': {
                        output += date.toLocaleDateString(locale, { timeZone: timeZone });
                        break;
                    }

                    // "Locale's appropriate time representation."
                    case 'X': {
                        output += date.toLocaleTimeString(locale, { timeZone: timeZone });
                        break;
                    }

                    // "Year within century [00,99]."
                    case 'y': {
                        output += getYear() % 100;
                        break;
                    }

                    // "Year with century as a decimal number."
                    case 'Y': {
                        output += getYear();
                        break;
                    }

                    // "Timezone name, or no characters if no timezone is determinable."
                    case 'Z': {
                        const parts = new Intl.DateTimeFormat(locale, { timeZone: timeZone, timeZoneName: 'short' }).formatToParts(date);
                        output += parts.find(it => it.type === 'timeZoneName').value;
                        break;
                    }

                    // "A <percent-sign> character."
                    case '%': output += '%'; break;

                    // We reached the end of the string, just output the %.
                    case undefined: output += '%'; break;

                    // If nothing matched, just output the input verbatim
                    default: output += '%' + char; break;
                }
                continue;
            }
            output += char;
        }
        output += '\n';

        await out.write(output);
    }
};
