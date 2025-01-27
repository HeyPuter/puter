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
import assert from 'assert';
import { MakeTestContext } from './harness.js'
import builtins from '../../src/puter-shell/coreutils/__exports__.js';

export const runPrintfTests = () => {
    describe('printf', function () {
        const testCases = [
            {
                description: 'outputs format verbatim if no operands were given',
                input: [ 'hello' ],
                expectedStdout: 'hello',
                expectedStderr: '',
            },
            {
                description: 'outputs octal escape sequences',
                input: [ '\\0\\41\\041' ],
                expectedStdout: '\0!!',
                expectedStderr: '',
            },
            {
                description: 'outputs a trailing backslash as itself',
                input: [ '\\' ],
                expectedStdout: '\\',
                expectedStderr: '',
            },
            {
                description: 'outputs unrecognized escape sequences as themselves',
                input: [ '\\z\\@\\#' ],
                expectedStdout: '\\z\\@\\#',
                expectedStderr: '',
            },
            {
                description: 'outputs escape sequences',
                input: [ '\\a\\b\\f\\n\\r\\t\\v' ],
                expectedStdout: '\x07\x08\x0C\n\r\t\x0B',
                expectedStderr: '',
            },
            {
                description: 'rejects empty format specifier',
                input: [ '%' ],
                expectedStdout: '',
                expectedStderr: 'printf: Invalid conversion specifier \'%\'\n',
                expectedFail: true,
            },
            {
                description: 'outputs `%%` as `%`',
                input: [ '%%' ],
                expectedStdout: '%',
                expectedStderr: '',
            },

            //
            // %c: Character
            //
            {
                description: 'outputs single characters for `%c`',
                input: [ '%c', 'hello', '123' ],
                expectedStdout: 'h1',
                expectedStderr: '',
            },
            {
                description: 'outputs single characters for `%c`',
                input: [ '%c', 'hello', '123' ],
                expectedStdout: 'h1',
                expectedStderr: '',
            },
            {
                description: 'supports padding and alignment for `%c`',
                input: [ '"%-12c" "%12c"', 'hello', '123' ],
                expectedStdout: '"h           " "           1"',
                expectedStderr: '',
            },

            //
            // %s: String
            //
            {
                description: 'outputs whole value as string for `%s`',
                input: [ '%s', 'hello', '123' ],
                expectedStdout: 'hello123',
                expectedStderr: '',
            },
            {
                description: 'supports padding and alignment for `%s`',
                input: [ '"%-12s" "%12s"', 'hello', '123' ],
                expectedStdout: '"hello       " "         123"',
                expectedStderr: '',
            },
            {
                description: 'supports precision for `%s`',
                input: [ '%.4s\n', 'hello', '123' ],
                expectedStdout: 'hell\n123\n',
                expectedStderr: '',
            },

            //
            // %d and %i: Signed decimal integer
            //
            {
                description: 'outputs a signed decimal integer for `%d` or `%i`',
                input: [ '%d %i\n', '13', '13', '-127', '-127' ],
                expectedStdout: '13 13\n-127 -127\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding for `%d` and `%i`',
                input: [ '"%5d" "%05i"\n', '13', '13', '-127', '-127' ],
                expectedStdout: '"   13" "00013"\n" -127" "-0127"\n',
                expectedStderr: '',
            },
            {
                description: 'supports alignment for `%d` and `%i`',
                input: [ '"%-5d" "%0-5i"\n', '13', '13', '-127', '-127' ],
                expectedStdout: '"13   " "13   "\n"-127 " "-127 "\n',
                expectedStderr: '',
            },
            {
                description: 'supports `+` flag for `%d` and `%i`',
                input: [ '"%+5d" "%+05i"\n', '13', '13', '-127', '-127' ],
                expectedStdout: '"  +13" "+0013"\n" -127" "-0127"\n',
                expectedStderr: '',
            },
            {
                description: 'supports `+` flag with alignment for `%d` and `%i`',
                input: [ '"%+-5d" "%+-05i"\n', '13', '13', '-127', '-127' ],
                expectedStdout: '"+13  " "+13  "\n"-127 " "-127 "\n',
                expectedStderr: '',
            },
            {
                description: 'supports ` ` flag for `%d` and `%i`',
                input: [ '"% 5d" "% 05i"\n', '13', '13', '-127', '-127' ],
                expectedStdout: '"   13" " 0013"\n" -127" "-0127"\n',
                expectedStderr: '',
            },
            {
                description: 'supports ` ` flag with alignment for `%d` and `%i`',
                input: [ '"% -5d" "% -05i"\n', '13', '13', '-127', '-127' ],
                expectedStdout: '" 13  " " 13  "\n"-127 " "-127 "\n',
                expectedStderr: '',
            },
            {
                description: '`+` flag overrides ` ` for `%d` and `%i`',
                input: [ '"%+ -5d" "%+ 05i"\n', '13', '13', '-127', '-127' ],
                expectedStdout: '"+13  " "+0013"\n"-127 " "-0127"\n',
                expectedStderr: '',
            },
            {
                description: 'supports precision for `%d` and `%i`',
                input: [ '"%.5d" "%0.5i"\n', '13', '13', '-127', '-127' ],
                expectedStdout: '"00013" "00013"\n"-00127" "-00127"\n',
                expectedStderr: '',
            },
            {
                description: '0 precision for `%d` and `%i`',
                input: [ '"%.d" "%.0i"\n', '13', '13', '-127', '-127', '0', '0' ],
                expectedStdout: '"13" "13"\n"-127" "-127"\n"" ""\n',
                expectedStderr: '',
            },

            //
            // %u: Unsigned decimal integer
            //
            {
                description: 'outputs an unsigned decimal integer for `%u`',
                input: [ '%u\n', '13', '0', '-127' ],
                expectedStdout: '13\n0\n4294967169\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding for `%u`',
                input: [ '"%5u" "%05u"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"   13" "00013"\n"    0" "00000"\n"4294967169" "4294967169"\n',
                expectedStderr: '',
            },
            {
                description: 'supports alignment for `%u`',
                input: [ '"%-5u" "%0-5u"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"13   " "13   "\n"0    " "0    "\n"4294967169" "4294967169"\n',
                expectedStderr: '',
            },
            {
                description: 'supports precision for `%u`',
                input: [ '"%.5u" "%0.5u"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"00013" "00013"\n"00000" "00000"\n"4294967169" "4294967169"\n',
                expectedStderr: '',
            },
            {
                description: 'ignores `+` and ` ` flags for `%u`',
                input: [ '"%+u" "% u"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"13" "13"\n"0" "0"\n"4294967169" "4294967169"\n',
                expectedStderr: '',
            },
            {
                description: '0 precision for `%u`',
                input: [ '"%.u" "%.0u"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"13" "13"\n"" ""\n"4294967169" "4294967169"\n',
                expectedStderr: '',
            },

            //
            // %o: Unsigned octal integer
            //
            {
                description: 'outputs an unsigned octal integer for `%o`',
                input: [ '%o\n', '13', '0', '-127' ],
                expectedStdout: '15\n0\n37777777601\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding for `%o`',
                input: [ '"%5o" "%05o"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"   15" "00015"\n"    0" "00000"\n"37777777601" "37777777601"\n',
                expectedStderr: '',
            },
            {
                description: 'supports alignment for `%o`',
                input: [ '"%-5o" "%0-5o"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"15   " "15   "\n"0    " "0    "\n"37777777601" "37777777601"\n',
                expectedStderr: '',
            },
            {
                description: 'supports precision for `%o`',
                input: [ '"%.5o" "%0.5o"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"00015" "00015"\n"00000" "00000"\n"37777777601" "37777777601"\n',
                expectedStderr: '',
            },
            {
                description: 'ignores `+` and ` ` flags for `%o`',
                input: [ '"%+o" "% o"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"15" "15"\n"0" "0"\n"37777777601" "37777777601"\n',
                expectedStderr: '',
            },
            {
                description: '0 precision for `%o`',
                input: [ '"%.o" "%.0o"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"15" "15"\n"" ""\n"37777777601" "37777777601"\n',
                expectedStderr: '',
            },
            {
                description: 'ensures a starting `0` when using the `#` flag for `%o`',
                input: [ '"%#o" "%#0o"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"015" "015"\n"0" "0"\n"037777777601" "037777777601"\n',
                expectedStderr: '',
            },

            //
            // %x and %X: Unsigned hexadecimal integer
            //
            {
                description: 'outputs an unsigned hexadecimal integer for `%x` and `%X`',
                input: [ '"%x" "%X"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"d" "D"\n"0" "0"\n"ffffff81" "FFFFFF81"\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding for `%x` and `%X`',
                input: [ '"%5x" "%05X"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"    d" "0000D"\n"    0" "00000"\n"ffffff81" "FFFFFF81"\n',
                expectedStderr: '',
            },
            {
                description: 'supports alignment for `%x` and `%X`',
                input: [ '"%-5x" "%0-5X"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"d    " "D    "\n"0    " "0    "\n"ffffff81" "FFFFFF81"\n',
                expectedStderr: '',
            },
            {
                description: 'supports precision for `%x` and `%X`',
                input: [ '"%.5x" "%0.5X"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"0000d" "0000D"\n"00000" "00000"\n"ffffff81" "FFFFFF81"\n',
                expectedStderr: '',
            },
            {
                description: 'ignores `+` and ` ` flags for `%x` and `%X`',
                input: [ '"%+x" "% X"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"d" "D"\n"0" "0"\n"ffffff81" "FFFFFF81"\n',
                expectedStderr: '',
            },
            {
                description: '0 precision for `%x` and `%X`',
                input: [ '"%.x" "%.0X"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"d" "D"\n"" ""\n"ffffff81" "FFFFFF81"\n',
                expectedStderr: '',
            },
            {
                description: 'ensures a starting `0x` or `0X` when using the `#` flag for `%x` and `%X`',
                input: [ '"%#x" "%#0X"\n', '13', '13', '0', '0', '-127', '-127' ],
                expectedStdout: '"0xd" "0XD"\n"0x0" "0X0"\n"0xffffff81" "0XFFFFFF81"\n',
                expectedStderr: '',
            },

            //
            // %f and %F: Floating point, decimal notation
            //
            {
                description: 'outputs a floating point number in decimal notation for `%f` and `%F`',
                input: [ '"%f" "%F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"13.000000" "13.000000"\n"-12345.678900" "-12345.678900"\n"0.000010" "0.000010"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding for `%f` and `%F`',
                input: [ '"%12f" "%012F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"   13.000000" "00013.000000"\n"-12345.678900" "-12345.678900"\n"    0.000010" "00000.000010"\n' +
                    '"    infinity" "    INFINITY"\n"         nan" "         NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding and alignment for `%f` and `%F`',
                input: [ '"%-12f" "%-012F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"13.000000   " "13.000000   "\n"-12345.678900" "-12345.678900"\n"0.000010    " "0.000010    "\n' +
                    '"infinity    " "INFINITY    "\n"nan         " "NAN         "\n',
                expectedStderr: '',
            },
            {
                description: 'supports `+` flag for `%f` and `%F`',
                input: [ '"%+12f" "%+012F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"  +13.000000" "+0013.000000"\n"-12345.678900" "-12345.678900"\n"   +0.000010" "+0000.000010"\n' +
                    '"   +infinity" "   +INFINITY"\n"        +nan" "        +NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports `+` flag with alignment for `%f` and `%F`',
                input: [ '"%+-12f" "%+-012F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"+13.000000  " "+13.000000  "\n"-12345.678900" "-12345.678900"\n"+0.000010   " "+0.000010   "\n' +
                    '"+infinity   " "+INFINITY   "\n"+nan        " "+NAN        "\n',
                expectedStderr: '',
            },
            {
                description: 'supports ` ` flag for `%f` and `%F`',
                input: [ '"% 12f" "% 012F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"   13.000000" " 0013.000000"\n"-12345.678900" "-12345.678900"\n"    0.000010" " 0000.000010"\n' +
                    '"    infinity" "    INFINITY"\n"         nan" "         NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports ` ` flag with alignment for `%f` and `%F`',
                input: [ '"% -12f" "% -012F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '" 13.000000  " " 13.000000  "\n"-12345.678900" "-12345.678900"\n" 0.000010   " " 0.000010   "\n' +
                    '" infinity   " " INFINITY   "\n" nan        " " NAN        "\n',
                expectedStderr: '',
            },
            {
                description: '`+` flag overrides ` ` for `%f` and `%F`',
                input: [ '"% +12f" "% +012F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"  +13.000000" "+0013.000000"\n"-12345.678900" "-12345.678900"\n"   +0.000010" "+0000.000010"\n' +
                    '"   +infinity" "   +INFINITY"\n"        +nan" "        +NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports precision for `%f` and `%F`',
                input: [ '"%.3f" "%0.3F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"13.000" "13.000"\n"-12345.679" "-12345.679"\n"0.000" "0.000"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'zero precision removes decimal point for `%f` and `%F`',
                input: [ '"%.0f" "%0.0F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"13" "13"\n"-12346" "-12346"\n"0" "0"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'zero precision with `#` flag forces a decimal point for `%f` and `%F`',
                input: [ '"%#.0f" "%0#.0F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"13." "13."\n"-12346." "-12346."\n"0." "0."\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports width and precision for `%f` and `%F`',
                input: [ '"%12.3f" "%012.3F"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"      13.000" "00000013.000"\n"  -12345.679" "-0012345.679"\n"       0.000" "00000000.000"\n' +
                    '"    infinity" "    INFINITY"\n"         nan" "         NAN"\n',
                expectedStderr: '',
            },

            //
            // %e and %E: Floating point, exponential notation
            //
            {
                description: 'outputs a floating point number in exponential notation for `%e` and `%E`',
                input: [ '"%e" "%E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"1.300000e+01" "1.300000E+01"\n"-1.234568e+04" "-1.234568E+04"\n"1.000000e-05" "1.000000E-05"\n' +
                    '"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding for `%e` and `%E`',
                input: [ '"%15e" "%015E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"   1.300000e+01" "0001.300000E+01"\n"  -1.234568e+04" "-001.234568E+04"\n"   1.000000e-05" "0001.000000E-05"\n' +
                    '"       infinity" "       INFINITY"\n"            nan" "            NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding and alignment for `%e` and `%E`',
                input: [ '"%-15e" "%-015E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"1.300000e+01   " "1.300000E+01   "\n"-1.234568e+04  " "-1.234568E+04  "\n"1.000000e-05   " "1.000000E-05   "\n' +
                    '"infinity       " "INFINITY       "\n"nan            " "NAN            "\n',
                expectedStderr: '',
            },
            {
                description: 'supports `+` flag for `%e` and `%E`',
                input: [ '"%+15e" "%+015E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"  +1.300000e+01" "+001.300000E+01"\n"  -1.234568e+04" "-001.234568E+04"\n"  +1.000000e-05" "+001.000000E-05"\n' +
                    '"      +infinity" "      +INFINITY"\n"           +nan" "           +NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports `+` flag with alignment for `%e` and `%E`',
                input: [ '"%+-15e" "%+-015E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"+1.300000e+01  " "+1.300000E+01  "\n"-1.234568e+04  " "-1.234568E+04  "\n"+1.000000e-05  " "+1.000000E-05  "\n' +
                    '"+infinity      " "+INFINITY      "\n"+nan           " "+NAN           "\n',
                expectedStderr: '',
            },
            {
                description: 'supports ` ` flag for `%e` and `%E`',
                input: [ '"% 15e" "% 015E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"   1.300000e+01" " 001.300000E+01"\n"  -1.234568e+04" "-001.234568E+04"\n"   1.000000e-05" " 001.000000E-05"\n' +
                    '"       infinity" "       INFINITY"\n"            nan" "            NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports ` ` flag with alignment for `%e` and `%E`',
                input: [ '"% -15e" "% -015E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '" 1.300000e+01  " " 1.300000E+01  "\n"-1.234568e+04  " "-1.234568E+04  "\n" 1.000000e-05  " " 1.000000E-05  "\n' +
                    '" infinity      " " INFINITY      "\n" nan           " " NAN           "\n',
                expectedStderr: '',
            },
            {
                description: '`+` flag overrides ` ` for `%e` and `%E`',
                input: [ '"% +15e" "% +015E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"  +1.300000e+01" "+001.300000E+01"\n"  -1.234568e+04" "-001.234568E+04"\n"  +1.000000e-05" "+001.000000E-05"\n' +
                    '"      +infinity" "      +INFINITY"\n"           +nan" "           +NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports precision for `%e` and `%E`',
                input: [ '"%.3e" "%0.3E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"1.300e+01" "1.300E+01"\n"-1.235e+04" "-1.235E+04"\n"1.000e-05" "1.000E-05"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'zero precision removes decimal point for `%e` and `%E`',
                input: [ '"%.0e" "%0.0E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"1e+01" "1E+01"\n"-1e+04" "-1E+04"\n"1e-05" "1E-05"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'zero precision with `#` flag forces a decimal point for `%e` and `%E`',
                input: [ '"%#.0e" "%0#.0E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"1.e+01" "1.E+01"\n"-1.e+04" "-1.E+04"\n"1.e-05" "1.E-05"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports width and precision for `%e` and `%E`',
                input: [ '"%15.3e" "%015.3E"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"      1.300e+01" "0000001.300E+01"\n"     -1.235e+04" "-000001.235E+04"\n"      1.000e-05" "0000001.000E-05"\n' +
                    '"       infinity" "       INFINITY"\n"            nan" "            NAN"\n',
                expectedStderr: '',
            },

            //
            // %g and %G: Floating point, set number of significant digits, may be decimal or exponential notation
            //
            {
                description: 'outputs a floating point number for `%g` and `%G`',
                input: [ '"%g" "%G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"13" "13"\n"-12345.7" "-12345.7"\n"1e-05" "1E-05"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding for `%g` and `%G`',
                input: [ '"%12g" "%012G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"          13" "000000000013"\n"    -12345.7" "-000012345.7"\n"       1e-05" "00000001E-05"\n' +
                    '"    infinity" "    INFINITY"\n"         nan" "         NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports padding and alignment for `%g` and `%G`',
                input: [ '"%-12g" "%-012G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"13          " "13          "\n"-12345.7    " "-12345.7    "\n"1e-05       " "1E-05       "\n' +
                    '"infinity    " "INFINITY    "\n"nan         " "NAN         "\n',
                expectedStderr: '',
            },
            {
                description: 'supports `+` flag for `%g` and `%G`',
                input: [ '"%+12g" "%+012G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"         +13" "+00000000013"\n"    -12345.7" "-000012345.7"\n"      +1e-05" "+0000001E-05"\n' +
                    '"   +infinity" "   +INFINITY"\n"        +nan" "        +NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports `+` flag with alignment for `%g` and `%G`',
                input: [ '"%+-12g" "%+-012G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"+13         " "+13         "\n"-12345.7    " "-12345.7    "\n"+1e-05      " "+1E-05      "\n' +
                    '"+infinity   " "+INFINITY   "\n"+nan        " "+NAN        "\n',
                expectedStderr: '',
            },
            {
                description: 'supports ` ` flag for `%g` and `%G`',
                input: [ '"% 12g" "% 012G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"          13" " 00000000013"\n"    -12345.7" "-000012345.7"\n"       1e-05" " 0000001E-05"\n' +
                    '"    infinity" "    INFINITY"\n"         nan" "         NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports ` ` flag with alignment for `%g` and `%G`',
                input: [ '"% -12g" "% -012G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '" 13         " " 13         "\n"-12345.7    " "-12345.7    "\n" 1e-05      " " 1E-05      "\n' +
                    '" infinity   " " INFINITY   "\n" nan        " " NAN        "\n',
                expectedStderr: '',
            },
            {
                description: '`+` flag overrides ` ` for `%g` and `%G`',
                input: [ '"% +12g" "% +012G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"         +13" "+00000000013"\n"    -12345.7" "-000012345.7"\n"      +1e-05" "+0000001E-05"\n' +
                    '"   +infinity" "   +INFINITY"\n"        +nan" "        +NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports precision for `%g` and `%G`',
                input: [ '"%.3g" "%0.3G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"13" "13"\n"-1.23e+04" "-1.23E+04"\n"1e-05" "1E-05"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'zero precision removes decimal point for `%g` and `%G`',
                input: [ '"%.0g" "%0.0G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"1e+01" "1E+01"\n"-1e+04" "-1E+04"\n"1e-05" "1E-05"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'zero precision with `#` flag forces a decimal point for `%g` and `%G`',
                input: [ '"%#.0g" "%0#.0G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"1.e+01" "1.E+01"\n"-1.e+04" "-1.E+04"\n"1.e-05" "1.E-05"\n"infinity" "INFINITY"\n"nan" "NAN"\n',
                expectedStderr: '',
            },
            {
                description: 'supports width and precision for `%g` and `%G`',
                input: [ '"%12.3g" "%012.3G"\n', '13', '13', '-12345.67890', '-12345.67890', '0.00001', '0.00001', 'Infinity', 'Infinity', 'NaN', 'NaN' ],
                expectedStdout: '"          13" "000000000013"\n"   -1.23e+04" "-0001.23E+04"\n"       1e-05" "00000001E-05"\n' +
                    '"    infinity" "    INFINITY"\n"         nan" "         NAN"\n',
                expectedStderr: '',
            },
        ];

        for (const { description, input, expectedStdout, expectedStderr, expectedFail } of testCases) {
            it(description, async () => {
                let ctx = MakeTestContext(builtins.printf, { positionals: input });
                let hadError = false;
                try {
                    const result = await builtins.printf.execute(ctx);
                    if (!expectedFail) {
                        assert.equal(result, undefined, 'should exit successfully, returning nothing');
                    }
                } catch (e) {
                    hadError = true;
                    if (!expectedFail) {
                        assert.fail(e);
                    }
                }
                if (expectedFail && !hadError) {
                    assert.fail('should have returned an error code');
                }
                assert.equal(ctx.externs.out.output, expectedStdout, 'wrong output written to stdout');
                assert.equal(ctx.externs.err.output, expectedStderr, 'wrong output written to stderr');
            });
        }
    });
};
