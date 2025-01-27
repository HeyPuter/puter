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
import columnify from "columnify";
import cli_columns from "cli-columns";
import { resolveRelativePath } from '../../util/path.js';

// formatLsTimestamp(): written by AI
function formatLsTimestamp(unixTimestamp) {
    const date = new Date(unixTimestamp * 1000); // Convert Unix timestamp to JavaScript Date
    const now = new Date();

    const optionsCurrentYear = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
    const optionsPreviousYear = { month: 'short', day: 'numeric', year: 'numeric' };

    // Check if the year of the date is the same as the current year
    if (date.getFullYear() === now.getFullYear()) {
        // Format for current year
        return date.toLocaleString('en-US', optionsCurrentYear)
            .replace(',', ''); // Remove comma from time);
    } else {
        // Format for previous year
        return date.toLocaleString('en-US', optionsPreviousYear)
            .replace(',', ''); // Remove comma from time);
    }
}

const B_to_human_readable = B => {
    const KiB = B / 1024;
    const MiB = KiB / 1024;
    const GiB = MiB / 1024;
    const TiB = GiB / 1024;
    if ( TiB > 1 ) {
        return `${TiB.toFixed(3)} TiB`;
    } else if ( GiB > 1 ) {
        return `${GiB.toFixed(3)} GiB`;
    } else if ( MiB > 1 ) {
        return `${MiB.toFixed(3)} MiB`;
    } else {
        return `${KiB.toFixed(3)} KiB`;
    }
}

export default {
    name: 'ls',
    usage: 'ls [OPTIONS] [PATH...]',
    description: 'List directory contents.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            all: {
                description: 'List all entries, including those starting with `.`',
                type: 'boolean',
                short: 'a'
            },
            long: {
                description: 'List entries in long format, as a table',
                type: 'boolean',
                short: 'l'
            },
            'human-readable': {
                description: 'Print sizes in a human readable format (eg 12MiB, 3GiB), instead of byte counts',
                type: 'boolean',
                short: 'h'
            },
            time: {
                description: 'Specify which time to display, one of atime (access time), ctime (creation time), or mtime (modification time)',
                type: 'string'
            },
            S: {
                description: 'Sort the results',
                type: 'boolean',
            },
            t: {
                description: 'Sort by time, newest first. See --time',
                type: 'boolean',
            },
            reverse: {
                description: 'Reverse the sort direction',
                type: 'boolean',
                short: 'r',
            },
        }
    },
    execute: async ctx => {
        console.log('ls context', ctx);
        console.log('env.COLS', ctx.env.COLS);
        // ctx.params to access processed args
        // ctx.args to access raw args
        const { positionals, values, pwd } = ctx.locals;
        const { filesystem } = ctx.platform;

        const paths = positionals.length < 1
            ? [pwd] : positionals ;

        const showHeadings = paths.length > 1 ? async ({ i, path }) => {
            if ( i !== 0 ) await ctx.externs.out.write('\n');
            await ctx.externs.out.write(path + ':\n');
        } : () => {};
        
        for ( let i=0 ; i < paths.length ; i++ ) {
            let path = paths[i];
            await showHeadings({ i, path });
            path = resolveRelativePath(ctx.vars, path);
            let result = await filesystem.readdir(path);
            console.log('ls items', result);

            if ( ! values.all ) {
                result = result.filter(item => !item.name.startsWith('.'));
            } 

            const reverse_sort = values.reverse;
            const decsort = (delegate) => {
                if ( ! reverse_sort ) return delegate;
                return (a, b) => -delegate(a, b);
            };

            const time_properties = {
                mtime: 'modified',
                ctime: 'created',
                atime: 'accessed',
            };

            if ( values.t ) {
                const timeprop = time_properties[values.time || 'mtime'];
                result = result.sort(decsort((a, b) => {
                    return b[timeprop] - a[timeprop];
                }));
            }

            if ( values.S ) {
                result = result.sort(decsort((a, b) => {
                    if ( a.is_dir && !b.is_dir ) return 1;
                    if ( !a.is_dir && b.is_dir ) return -1;
                    return b.size - a.size;
                }));
            }

            // const write_item = values.long
            //     ? item => {
            //         let line = '';
            //         line += item.is_dir ? 'd' : item.is_symlink ? 'l' : '-';
            //         line += ' ';
            //         line += item.is_dir ? 'N/A' : item.size;
            //         line += ' ';
            //         line += item.name;
            //         return line;
            //     }
            //     : item => item.name
            //     
            const icons = {
                // d: '📁',
                // l: '🔗',
            };

            const colors = {
                'd-': 'blue',
                'ds': 'magenta',
                'l-': 'cyan',
            };

            const col_to_ansi = {
                blue: '34',
                cyan: '36',
                green: '32',
                magenta: '35',
            };

            const col = (type, text) => {
                if ( ! colors[type] ) return text;
                return `\x1b[${col_to_ansi[colors[type]]};1m${text}\x1b[0m`;
            }


            const POSIX = filesystem.capabilities['readdir.posix-mode'];

            const simpleTypeForItem = (item) => {
                return (item.is_dir ? 'd' : item.is_symlink ? 'l' : '-')
                    + ( (item.subdomains && item.subdomains.length) ? 's' : '-' );
            };

            if ( values.long ) {
                const time = values.time || 'mtime';
                const items = result.map(item => {
                    const ts = item[time_properties[time]];
                    const www = 
                        (!item.subdomains) ? 'N/A' :
                        (!item.subdomains.length) ? '---' :
                        item.subdomains[0].address + (
                            item.subdomains.length > 1
                                ? ` +${item.subdomains.length - 1}`
                                : ''
                        )
                    const type = simpleTypeForItem(item);
                    const mode = POSIX ? item.mode_human_readable : null;

                    let size = item.size;
                    if ( values['human-readable'] ) {
                        size = B_to_human_readable(size);
                    }
                    if ( item.is_dir && ! POSIX ) size = 'N/A';
                    return {
                        ...item,
                        user: item.uid,
                        group: item.gid,
                        mode,
                        type: icons[type] || type,
                        name: col(type, item.name),
                        www: www,
                        size: size,
                        [time_properties[time]]: formatLsTimestamp(ts),
                    };
                });
                const text = columnify(items, {
                    columns: [
                        POSIX ? 'mode' : 'type',
                        'name',
                        ...(POSIX ? ['user', 'group'] : []),
                        ...(filesystem.capabilities['readdir.www'] ? ['www'] : []),
                        'size', time_properties[time],
                    ],
                    maxLineWidth: ctx.env.COLS ?? 80,
                    config: {
                        // json: {
                        //     maxWidth: 20,
                        // }
                    }
                });
                const lines = text.split('\n');
                for ( const line of lines ) {
                    await ctx.externs.out.write(line + '\n');
                }
                continue;
            }

            console.log('what is', cli_columns);

            const names = result.map(item => {
                return col(simpleTypeForItem(item), item.name);
            });
            const text = cli_columns(names, {
                width: ctx.env.COLS,
            })

            const lines = text.split('\n');

            for ( const line of lines ) {
                await ctx.externs.out.write(line + '\n');
            }
        }
    }
};
