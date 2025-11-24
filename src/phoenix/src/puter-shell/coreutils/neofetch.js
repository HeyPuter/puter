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
import { SHELL_VERSIONS } from '../../meta/versions.js';

const logo = `
             ▄████▄  ▄▄█████▄_
    _▄███▀▀██▀    ▐██▀¬     '▀█▄
  ╓██└           ▐█▀           ▀█
 (█▀             █▌             ██
 █▌          ▄██▀▀▀██▄          ▀██▄
 ██         ▐█                     ██
  █▌                               ▐█
   ▀█▄_                           ▄█▀
     '▀▀████   █████   ████▌   ██▀▀
          ▐█      ██      █▌
          ▐█      ██      █▌
     _▄_▄██\`      ██      '▀█▄_▄_
   ╒█▀▀▀█▌        ██        ▐█▀\`▀█▄
   ▐█▄_▄█▌      ╓████▄      ▐█▄_▄█▌
     ▀▀▀\`       █▌  ▐█        ▀▀▀\`
                '▀███▀
`.slice(1);

export default {
    name: 'neofetch',
    usage: 'neofetch',
    description: 'Print information about the system.',
    execute: async ctx => {
        const cols = [17, 18, 19, 26, 27].reverse();
        const C25 = n => `\x1B[38;5;${n}m`;
        const B25 = n => `\x1B[48;5;${n}m`;
        const COL = C25(27);
        const END = '\x1B[0m';
        const lines = logo.split('\n').map(line => {
            while ( line.length < 40 ) line += ' ';
            return line;
        });

        for ( let i = 0 ; i < lines.length ; i++ ) {
            let ind = Math.floor(i / 5);
            const col = cols[ind];
            lines[i] = `\x1B[38;5;${col}m${ lines[i] }${END}`;
        }

        {
            const org = lines[9];
            lines[9] = org.slice(0, 34) + C25(cols[2]) + org.slice(34);
        }
        {
            let org = lines[10];
            org = org.slice(10);
            lines[10] = C25(cols[1]) + org.slice(0, 12) +
                C25(cols[2]) + org.slice(12);
        }

        lines[0] += `${COL + ctx.env.USER + END }@${
            COL }${ctx.env.HOSTNAME }${END}`;
        lines[1] += '-----------------';
        lines[2] += `${COL }OS${ END }: Puter`;
        lines[3] += `${COL }Shell${ END }: Puter Shell v${ SHELL_VERSIONS[0].v}`;
        lines[4] += `${COL }Window${ END }: ${ctx.env.COLS}x${ctx.env.ROWS}`;
        lines[5] += `${COL }Commands${ END }: ${Object.keys(ctx.registries.builtins).length}`;

        const colors = [[], []];
        for ( let i = 0 ; i < 16 ; i++ ) {
            let ri = i < 8 ? 14 : 15;
            let esc = i < 9
                ? `\x1B[3${i}m\x1B[4${i}m`
                : C25(i) + B25(i) ;
            lines[ri] += `${esc }   `;
        }
        lines[14] += '\x1B[0m';
        lines[15] += '\x1B[0m';

        for ( const line of lines ) {
            await ctx.externs.out.write(`${line }\n`);
        }
    },
};
