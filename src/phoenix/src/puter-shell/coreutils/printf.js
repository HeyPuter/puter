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

// TODO: get these values from a common place
// DRY: Copied from echo_escapes.js
const BEL = String.fromCharCode(7);
const BS  = String.fromCharCode(8);
const VT  = String.fromCharCode(0x0B);
const FF  = String.fromCharCode(0x0C);

function parseFormat(input, startOffset) {
    let i = startOffset;

    if (input[i] !== '%') {
        throw new Error('Called parseFormat() without a format specifier!');
    }
    i++;

    const result = {
        flags: {
            leftJustify: false,
            prefixWithSign: false,
            prefixWithSpaceIfWithoutSign: false,
            alternativeForm: false,
            padWithLeadingZeroes: false,
        },
        fieldWidth: null,
        precision: null,
        conversionSpecifier: null,

        newOffset: startOffset,
    };

    // Output a single % for '%%' or '%' followed by the end of the input.
    if (input[i] === '%') {
        i++;
        result.conversionSpecifier = '%';
        result.newOffset = i;
        return result;
    }

    const consumeInteger = () => {
        const startIndex = i;
        while (input[i] >= '0' && input[i] <= '9') {
            i++;
        }
        if (startIndex === i) {
            return null;
        }

        const integerString = input.substring(startIndex, i);
        return Number.parseInt(integerString, 10);
    };

    // Flags
    const possibleFlags = '-+ #0';
    while (possibleFlags.includes(input[i])) {
        switch (input[i]) {
            case '-': result.flags.leftJustify = true; break;
            case '+': result.flags.prefixWithSign = true; break;
            case ' ': result.flags.prefixWithSpaceIfWithoutSign = true; break;
            case '#': result.flags.alternativeForm = true; break;
            case '0': result.flags.padWithLeadingZeroes = true; break;
        }
        i++;
    }

    // Field width
    result.fieldWidth = consumeInteger();

    // Precision
    if (input[i] === '.') {
        i++;
        result.precision = consumeInteger() || 0;
    }

    // Conversion specifier
    const possibleConversionSpecifiers = 'cdeEfFgGiousxX';
    if (possibleConversionSpecifiers.includes(input[i])) {
        result.conversionSpecifier = input[i];
        i++;
    } else {
        throw new Error(`Invalid conversion specifier '${input.substring(startOffset, i + 1)}'`);
    }

    result.newOffset = i;
    return result;
}

function formatOutput(parsedFormat, remainingArguments) {
    const { flags, fieldWidth, precision, conversionSpecifier } = parsedFormat;

    const padAndAlignString = (input) => {
        if (!fieldWidth || input.length >= fieldWidth) {
            return input;
        }

        const padding = ' '.repeat(fieldWidth - input.length);
        return flags.leftJustify ? (input + padding) : (padding + input);
    };

    const formatInteger = (integer, specifier) => {
        const unsigned = 'ouxX'.includes(specifier);
        const radix = (() => {
            switch (specifier) {
                case 'o': return 8;
                case 'x':
                case 'X': return 16;
                default: return 10;
            }
        })();

        // POSIX doesn't specify what we should do to format a negative number as %u.
        // Common behavior seems to be bit-casting it to unsigned.
        if (unsigned && integer < 0) {
            integer = integer >>> 0;
        }

        let digits = Math.abs(integer).toString(radix);
        if (specifier === 'o' && flags.alternativeForm && digits[0] !== '0') {
            // "For the o conversion specifier, it shall increase the precision to force the first digit of the result to be a zero."
            // (Where 'it' is the alternative form flag.)
            digits = '0' + digits;
        }
        const signOrPrefix = (() => {
            if (flags.alternativeForm) {
                if (specifier === 'x') return '0x';
                if (specifier === 'X') return '0X';
            }
            if (unsigned) return '';
            if (integer < 0) return '-';
            if (flags.prefixWithSign) return '+';
            if (flags.prefixWithSpaceIfWithoutSign) return ' ';
            return '';
        })();

        // Expand digits with 0s, up to `precision` characters.
        // "The default precision shall be 1."
        const usedPrecision = precision ?? 1;
        // Special case: "The result of converting a zero value with a precision of 0 shall be no characters."
        if (usedPrecision === 0 && integer === 0) {
            digits = '';
        } else if (digits.length < precision) {
            digits = '0'.repeat(precision - digits.length) + digits;
        }

        // Pad up to `fieldWidth` with spaces or 0s.
        const width = signOrPrefix.length + digits.length;
        let output = signOrPrefix + digits;
        if (width < fieldWidth) {
            if (flags.leftJustify) {
                output = signOrPrefix + digits + ' '.repeat(fieldWidth - width);
            } else if (precision === null && flags.padWithLeadingZeroes) {
                // "For d, i , o, u, x, and X conversion specifiers, if a precision is specified, the '0' flag shall be ignored."
                output = signOrPrefix + '0'.repeat(fieldWidth - width) + digits;
            } else {
                output = ' '.repeat(fieldWidth - width) + signOrPrefix + digits;
            }
        }

        if (specifier === specifier.toUpperCase()) {
            output = output.toUpperCase();
        }

        return output;
    };

    const formatFloat = (float, specifier) => {
        if (float === undefined) float = 0;

        const sign = (() => {
            if (float < 0) return '-';
            if (flags.prefixWithSign) return '+';
            if (flags.prefixWithSpaceIfWithoutSign) return ' ';
            return '';
        })();
        const floatString = (() => {
            // NaN and Infinity are the same regardless of representation
            if (!isFinite(float)) {
                return float.toString();
            }

            const formatExponential = (mantissaString, exponent) => {
                // #: "For [...] e, E, [...] conversion specifiers, the result shall always contain a radix character,
                // even if no digits follow the radix character."
                if (flags.alternativeForm && !mantissaString.includes('.')) {
                    mantissaString += '.';
                }

                // "The exponent shall always contain at least two digits."
                const exponentOutput = (() => {
                    if (exponent <= -10 || exponent >= 10) return exponent.toString();
                    if (exponent < 0) return '-0' + Math.abs(exponent).toString();
                    return '+0' + Math.abs(exponent).toString();
                })();
                return mantissaString + 'e' + exponentOutput;
            };

            switch (specifier) {
                // TODO: %a and %A, floats in hexadecimal
                case 'e':
                case 'E': {
                    // "When the precision is missing, six digits shall be written after the radix character"
                    const usedPrecision = precision ?? 6;
                    // We unfortunately can't fully rely on toExponential() because printf has different formatting rules.
                    const [mantissaString, exponentString] = Math.abs(float).toExponential(usedPrecision).split('e');
                    const exponent = Number.parseInt(exponentString);
                    return formatExponential(mantissaString, exponent);
                }
                case 'f':
                case 'F': {
                    // "If the precision is omitted from the argument, six digits shall be written after the radix character"
                    const usedPrecision = precision ?? 6;
                    const result = Math.abs(float).toFixed(usedPrecision);
                    if (flags.alternativeForm && usedPrecision === 0) {
                        // #: "For [...] f, F, [...] conversion specifiers, the result shall always contain a radix character,
                        // even if no digits follow the radix character."
                        return result + '.';
                    }
                    return result;
                }
                case 'g':
                case 'G': {
                    // Default isn't specified in the spec, but 6 matches behavior of other implementations.
                    const usedPrecision = precision ?? 6;

                    // "The style used depends on the value converted: style e (or E) shall be used only if the exponent
                    // resulting from the conversion is less than -4 or greater than or equal to the precision."
                    // We add a digit of precision to make sure we don't break things when rounding later.
                    const [mantissaString, exponentString] = Math.abs(float).toExponential(usedPrecision + 1).split('e');
                    const mantissa = Number.parseFloat(mantissaString);
                    const exponent = Number.parseInt(exponentString);

                    // Unfortunately, `float.toPrecision()` doesn't use the same rules as printf to decide whether to
                    // use decimal or exponential representation, so we have to construct the output ourselves.
                    const usingExponential = exponent > usedPrecision || exponent < -4;
                    if (usingExponential) {
                        const decimalDigits = Math.max(0, usedPrecision - (mantissa < 1 ? 0 : 1));
                        // "Trailing zeros are removed from the result."
                        let mantissaOutput = mantissa.toFixed(decimalDigits)
                           .replace(/\.0+/, '');
                        return formatExponential(mantissaOutput, exponent);
                    }

                    // Decimal representation
                    const result = Math.abs(float).toPrecision(usedPrecision);
                    if (flags.alternativeForm && usedPrecision === 0) {
                        // #: "For [...] g, and G conversion specifiers, the result shall always contain a radix character,
                        // even if no digits follow the radix character."
                        return result + '.';
                    }
                    // Trailing zeros are removed from the result.
                    return result.replace(/\.0+/, '');
                }
                default: throw new Error(`Invalid float specifier '${specifier}'`);
            }
        })();

        // Pad up to `fieldWidth` with spaces or 0s.
        const width = sign.length + floatString.length;
        let output = sign + floatString;
        if (width < fieldWidth) {
            if (flags.leftJustify) {
                output = sign + floatString + ' '.repeat(fieldWidth - width);
            } else if (flags.padWithLeadingZeroes && isFinite(float)) {
                output = sign + '0'.repeat(fieldWidth - width) + floatString;
            } else {
                output = ' '.repeat(fieldWidth - width) + sign + floatString;
            }
        }

        if (specifier === specifier.toUpperCase()) {
            output = output.toUpperCase();
        } else {
            output = output.toLowerCase();
        }

        return output;
    };

    switch (conversionSpecifier) {
        // TODO: a,A: Float in hexadecimal format
        // TODO: b: binary data with escapes
        // TODO: Any other common options that are not in the posix spec

        // Integers
        case 'd':
        case 'i':
        case 'o':
        case 'u':
        case 'x':
        case 'X': {
            return formatInteger(Number.parseInt(remainingArguments.shift()) || 0, conversionSpecifier);
        }

        // Floating point numbers
        case 'e':
        case 'E':
        case 'f':
        case 'F':
        case 'g':
        case 'G': {
            return formatFloat(Number.parseFloat(remainingArguments.shift()), conversionSpecifier);
        }

        // Single character
        case 'c': {
            const argument = remainingArguments.shift() || '';
            // It's unspecified whether an empty string produces a null byte or nothing.
            // We'll go with nothing for now.
            return padAndAlignString(argument[0] || '');
        }

        // String
        case 's': {
            let argument = remainingArguments.shift() || '';
            if (precision && precision < argument.length) {
                argument = argument.substring(0, precision);
            }
            return padAndAlignString(argument);
        }

        // Percent sign
        case '%': return '%';
    }
}

function highlight(text) {
    return `\x1B[92m${text}\x1B[0m`;
}

// https://pubs.opengroup.org/onlinepubs/9699919799/utilities/printf.html
export default {
    name: 'printf',
    usage: 'printf FORMAT [ARGUMENT...]',
    description: 'Write a formatted string to standard output.\n\n' +
        'The output is determined by FORMAT, with any escape sequences replaced, and any format strings applied to the following ARGUMENTs.\n\n' +
        'FORMAT is written repeatedly until all ARGUMENTs are consumed. If FORMAT does not consume any ARGUMENTs, it is only written once.',
    helpSections: {
        'Escape Sequences': 'The following escape sequences are understood:\n\n' +
            `    ${highlight('\\\\')}     A literal \\\n` +
            `    ${highlight('\\a')}     Terminal BELL\n` +
            `    ${highlight('\\b')}     Backspace\n` +
            `    ${highlight('\\f')}     Form-feed\n` +
            `    ${highlight('\\n')}     Newline\n` +
            `    ${highlight('\\r')}     Carriage return\n` +
            `    ${highlight('\\t')}     Horizontal tab\n` +
            `    ${highlight('\\v')}     Vertical tab\n` +
            `    ${highlight('\\###')}   A byte with the octal value of ### (between 1 and 3 digits)`,
        'Format Strings': 'Format strings behave like C printf. ' +
            'A format string is, in order: a `%`, zero or more flags, a width, a precision, and a conversion specifier. ' +
            'All except the initial `%` and the conversion specifier are optional.\n\n' +
            'Flags:\n\n' +
            `    ${highlight('-')}       Left-justify the result\n` +
            `    ${highlight('+')}       For numeric types, always include a sign character\n` +
            `    ${highlight('\' \'')}     ${highlight('(space)')} For numeric types, include a space where the sign would go for positive numbers. Overridden by ${highlight('+')}.\n`+
            `    ${highlight('#')}       Use alternative form, depending on the conversion:\n` +
            `            ${highlight('o')}              Ensure result is always prefixed with a '0'\n` +
            `            ${highlight('x,X')}            Prefix result with '0x' or '0X' respectively\n` +
            `            ${highlight('e,E,f,F,g,G')}    Always include a decimal point. For ${highlight('g,G')}, also keep trailing 0s\n\n` +
            'Width:\n\n' +
            'A number, for how many characters the result should occupy.\n\n' +
            'Precision:\n\n' +
            'A \'.\' followed optionally by a number. If no number is specified, it is taken as 0. Effect depends on the conversion:\n\n' +
            `    ${highlight('d,i,o,u,x,X')}    Determines the minimum number of digits\n` +
            `    ${highlight('e,E,f,F')}        Determines the number of digits after the decimal point\n\n` +
            `    ${highlight('g,G')}            Determines the number of significant figures\n\n` +
            `    ${highlight('s')}              Determines the maximum number of characters to be printed\n\n` +
            'Conversion specifiers:\n\n' +
            `    ${highlight('%')}       A literal '%'\n` +
            `    ${highlight('s')}       ARGUMENT as a string\n` +
            `    ${highlight('c')}       The first character of ARGUMENT as a string\n` +
            `    ${highlight('d,i')}     ARGUMENT as a number, formatted as a signed decimal integer\n` +
            `    ${highlight('u')}       ARGUMENT as a number, formatted as an unsigned decimal integer\n` +
            `    ${highlight('o')}       ARGUMENT as a number, formatted as an unsigned octal integer\n` +
            `    ${highlight('x,X')}     ARGUMENT as a number, formatted as an unsigned hexadecimal integer, in lower or uppercase respectively\n` +
            `    ${highlight('e,E')}     ARGUMENT as a number, formatted as a float in exponential notation, in lower or uppercase respectively\n` +
            `    ${highlight('f,F')}     ARGUMENT as a number, formatted as a float in decimal notation, in lower or uppercase respectively\n` +
            `    ${highlight('g,G')}     ARGUMENT as a number, formatted as a float in either decimal or exponential notation, in lower or uppercase respectively`,
    },
    args: {
        $: 'simple-parser',
        allowPositionals: true
    },
    execute: async ctx => {
        const { out, err } = ctx.externs;
        const { positionals } = ctx.locals;
        const [ format, ...remainingArguments ] = ctx.locals.positionals;

        if (positionals.length === 0) {
            await err.write('printf: Missing format argument\n');
            throw new Exit(1);
        }

        // We process the format as many times as needed to consume all of remainingArguments, but always at least once.
        do {
            const previousRemainingArgumentCount = remainingArguments.length;
            let output = '';

            for (let i = 0; i < format.length; ++i) {
                let char = format[i];
                // Escape sequences
                if (char === '\\') {
                    char = format[++i];
                    switch (char) {
                        case undefined: {
                            // We reached the end of the string, just output the slash.
                            output += '\\';
                            break;
                        }
                        case '\\': output += '\\'; break;
                        case 'a': output += BEL; break;
                        case 'b': output += BS; break;
                        case 'f': output += FF; break;
                        case 'n': output += '\n'; break;
                        case 'r': output += '\r'; break;
                        case 't': output += '\t'; break;
                        case 'v': output += VT; break;
                        default: {
                            // 1 to 3-digit octal number
                            if (char >= '0' && char <= '9') {
                                const digitsStartI = i;
                                if (format[i+1] >= '0' && format[i+1] <= '9') {
                                    i++;
                                    if (format[i+1] >= '0' && format[i+1] <= '9') {
                                        i++;
                                    }
                                }

                                const octalString = format.substring(digitsStartI, i + 1);
                                const octalValue = Number.parseInt(octalString, 8);
                                output += String.fromCodePoint(octalValue);
                                break;
                            }

                            // Unrecognized, so just output the sequence verbatim.
                            output += '\\' + char;
                            break;
                        }
                    }
                    continue;
                }

                // Conversion specifiers
                if (char === '%') {
                    // Parse the conversion specifier
                    let parsedFormat;
                    try {
                        parsedFormat = parseFormat(format, i);
                    } catch (e) {
                        await err.write(`printf: ${e.message}\n`);
                        throw new Exit(1);
                    }
                    i = parsedFormat.newOffset - 1; // -1 because we're about to increment i in the loop header

                    // Output the result
                    output += formatOutput(parsedFormat, remainingArguments);
                    continue;
                }

                // Everything else is copied directly.
                // TODO: Append these to the output in batches, for performance?
                output += char;
            }

            await out.write(output);

            // "If the format operand contains no conversion specifications and argument operands are present, the results are unspecified."
            // We handle this by printing it once and stopping.
            if (remainingArguments.length === previousRemainingArgumentCount) {
                break;
            }
        } while (remainingArguments.length > 0);

    }
};
