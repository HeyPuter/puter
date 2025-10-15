const { ansi_visible_length } = require("@heyputer/putility/src/libs/string");
const BaseService = require("./BaseService");

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
        let longest_lines_length = 0;
        for ( const line of lines ) {
            const this_lines_length = ansi_visible_length(line);
            if ( this_lines_length > longest_lines_length ) {
                longest_lines_length = this_lines_length;
            }
        }
        
        if ( title.length > longest_lines_length ) {
            longest_lines_length = title.length;
        }
        
        ({
            highlighter: () => {
                console.log(`\x1B[${colors.bginv}m▐\x1B[0m\x1B[${colors.bg}m ${title} \x1B[0m`);
                for ( const line of lines ) {
                    console.log(`\x1B[${colors.bginv}m▐▌\x1B[0m${line}\x1B[0m`);
                }
            },
            stars: () => {
                const len = longest_lines_length + 1;
                const horiz = Array(len).fill('*').join('');
                console.log(`\x1B[${colors.bginv}m**${horiz}**\x1B[0m`);
                console.log(`\x1B[${colors.bginv}m*\x1B[0m ${(title + ':').padEnd(len)} \x1B[${colors.bginv}m*\x1B[0m`);
                for ( const line of lines ) {
                    const diff = line.length - ansi_visible_length(line);
                    console.log(`\x1B[${colors.bginv}m*\x1B[0m ${line.padEnd(len + diff)} \x1B[${colors.bginv}m*\x1B[0m`);
                }
                console.log(`\x1B[${colors.bginv}m**${horiz}**\x1B[0m`);
            },
        })[style ?? 'highlighter']();
    }
    turn_on_the_warning_lights () {}
    add_widget () {}
    remove_widget () {}
}

module.exports = {
    NullDevConsoleService,
    TEAL,
};
