const { surrounding_box } = require("../fun/dev-console-ui-utils");
const BaseService = require("./BaseService");

const SOURCE_CODE_TIPS = `
    Most services are registered in CoreModule.js
    Boot sequence events are different from service events
    ExpectationService exists to ensure Puter doesn't miss a step
    Services are composable; StrategyService is a good example
    API endpoints should be on a separate origin in production
    There is some limited query-building in packages/backend/src/om
`;

const tips = (
    // CLI tips
    `
    Type \`help\` to see a list of commands
    \`logs:show\` toggles log output; useful when typing long commands
    \`logs:indent \` toggles indentation for some logs
    \`lock:locks \` will list any active mutex locks
    `,
    // Source code tips
    `
    Most services are registered in CoreModule.js
    Boot sequence events are different from service events
    ExpectationService exists to ensure Puter doesn't miss a step
    Services are composable; StrategyService is a good example
    API endpoints should be on a separate origin in production
    These messages come from DevTODService.js
    `
).split('\n').map((line) => line.trim())
    .filter((line) => line.length)
    .map(tip => {
        const lines = [];
        const WRAP = process.stdout.columns || 50;
        while ( tip.length ) {
            lines.push(tip.substring(0, WRAP));
            tip = tip.substring(WRAP);
        }
        return lines;
    })

class DevTODService extends BaseService {
    async _init () {
        const svc_commands = this.services.get('commands');
        this._register_commands(svc_commands);
    }
    async ['__on_boot.consolidation'] () {
        const random_tip = tips[Math.floor(Math.random() * tips.length)];
        this.tod_widget = () => {
            const lines = [
                "",
                "\x1B[1mTip of the Day\x1B[0m",
                ...random_tip,
                "Type tod:dismiss to un-stick this message",
                "",
            ];
            surrounding_box('33;1', lines);
            return lines;
        }

        this.tod_widget.unimportant = true;

        const svc_devConsole = this.services.get('dev-console', { optional: true });
        if ( ! svc_devConsole ) return;
        svc_devConsole.add_widget(this.tod_widget);
    }

    _register_commands (commands) {
        commands.registerCommands('tod', [
            {
                id: 'dismiss',
                description: 'Dismiss the startup message',
                handler: async (_, log) => {
                    const svc_devConsole = this.services.get('dev-console', { optional: true });
                    if ( ! svc_devConsole ) return;
                    svc_devConsole.remove_widget(this.tod_widget);
                    const lines = this.tod_widget();
                    for ( const line of lines ) log.log(line);
                    this.tod_widget = null;
                }
            }
        ]);
    }
}

module.exports = { DevTODService };