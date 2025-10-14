const BaseService = require("./BaseService");

/**
 * When DevConsoleService is not enabled, it is a more robust approach
 * to replace it with a null implementation rather than not have
 * 'dev-console' present in the services registry. This is because any
 * errors caused by accessing methods on 'dev-console' without ensuring
 * it exists are likely only to be caught in the production environment.
 */
class NullDevConsoleService extends BaseService {
    notice ({ colors, title, lines }) {
        colors = colors ?? {
            bg: '46',
            bginv: '36',
        };

        console.log(`\x1B[${colors.bginv}m▐\x1B[0m\x1B[${colors.bg}m ${title} \x1B[0m`);
        for ( const line of lines ) {
            console.log(`\x1B[${colors.bginv}m▐▌\x1B[0m${line}\x1B[0m`);
        }
    }
    turn_on_the_warning_lights () {}
    add_widget () {}
    remove_widget () {}
}

module.exports = {
    NullDevConsoleService
};
