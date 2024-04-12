const { AdvancedBase } = require("puter-js-common");

class SelfhostedModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const DefaultUserService = require('./services/DefaultUserService');
        services.registerService('__default-user', DefaultUserService);

        const ComplainAboutVersionsService = require('./services/ComplainAboutVersionsService');
        services.registerService('complain-about-versions', ComplainAboutVersionsService);

        const DevWatcherService = require('./services/DevWatcherService');
        const path_ = require('path');
        services.registerService('__dev-watcher', DevWatcherService, {
            root: path_.resolve(__dirname, '../../../'),
            commands: [
                {
                    name: 'puter.js:webpack-watch',
                    directory: 'packages/puter-js',
                    command: 'npm',
                    args: ['run', 'start-webpack'],
                },
            ],
        });

        const ServeStaticFilesService = require("./services/ServceStaticFilesService");
        services.registerService('__serve-puterjs', ServeStaticFilesService, {
            directories: [
                {
                    prefix: '/sdk',
                    path: path_.resolve(__dirname, '../../../packages/puter-js/dist'),
                },
            ],
        });
    }
}

module.exports = SelfhostedModule;
