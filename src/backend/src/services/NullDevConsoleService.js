const { ansi_visible_length } = require('@heyputer/putility/src/libs/string');
const BaseService = require('./BaseService');

const TEAL = {
    bg: '38;2;0;0;0;48;2;0;252;202;1',
    bginv: '38;2;0;252;202;1',
};

/**
 * When DevConsoleService is not enabled, it is a more robust approach
 * to replace it with a null implementation rather than not have
 * 'dev-console' present in the services registry. This is because any
 * errors caused by accessing methods on 'dev-console' without ensuring
 * it exists are likely only to be caught in the production environment.
 */
class NullDevConsoleService extends BaseService {
    notice ({ colors, title, lines, style }) {
        colors = colors ?? {
            bg: '46',
            bginv: '36',
        };

        // line length
        let longest = 0;
        for ( const line of lines ) {
            const this_lines_length = ansi_visible_length(line);
            if ( this_lines_length > longest ) {
                longest = this_lines_length;
            }
        }

        const longestWithTitle = Math.max(longest, ansi_visible_length(title));

        const realConsole = globalThis.original_console_object ?? console;

        ({
            highlighter: () => {
                realConsole.log(`\x1B[${colors.bginv}m▐\x1B[0m\x1B[${colors.bg}m ${title} \x1B[0m`);
                for ( const line of lines ) {
                    realConsole.log(`\x1B[${colors.bginv}m▐▌\x1B[0m${line}\x1B[0m`);
                }
            },
            highlighter2: () => {
                let top = '';
                for ( let i = title.length + 2; i < longest + 3; i++ ) top += `\x1B[${colors.bginv}m▁\x1B[0m`;
                realConsole.log(`\x1B[${colors.bginv}m▐\x1B[0m\x1B[${colors.bg}m ${title}${top || ' '}\x1B[0m`);
                for ( const line of lines ) {
                    const diff = line.length - ansi_visible_length(line);
                    realConsole.log(`\x1B[${colors.bginv}m▐▌\x1B[0m${line.padEnd(longest + diff)}` +
                        `\x1B[${colors.bginv}m▐\x1B[0m`);
                }
                realConsole.log(` \x1B[${colors.bginv}m${Array(longest + 2).fill('▔').join('')}\x1B[0m`);
            },
            stars: () => {
                const len = longestWithTitle + 1;
                const horiz = Array(len).fill('*').join('');
                realConsole.log(`\x1B[${colors.bginv}m**${horiz}**\x1B[0m`);
                realConsole.log(`\x1B[${colors.bginv}m*\x1B[0m ${(`${title }:`).padEnd(len)} \x1B[${colors.bginv}m*\x1B[0m`);
                for ( const line of lines ) {
                    const diff = line.length - ansi_visible_length(line);
                    realConsole.log(`\x1B[${colors.bginv}m*\x1B[0m ${line.padEnd(len + diff)} \x1B[${colors.bginv}m*\x1B[0m`);
                }
                realConsole.log(`\x1B[${colors.bginv}m**${horiz}**\x1B[0m`);
            },
        })[style ?? 'highlighter2']();
    }
    turn_on_the_warning_lights () {
    }
    add_widget () {
    }
    remove_widget () {
    }
}

module.exports = {
    NullDevConsoleService,
    TEAL,
};
