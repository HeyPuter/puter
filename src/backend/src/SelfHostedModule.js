const { AdvancedBase } = require("@heyputer/puter-js-common");
const config = require("./config");

class SelfHostedModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { SelfhostedService } = require('./services/SelfhostedService');
        services.registerService('__selfhosted', SelfhostedService);

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
                    directory: 'src/puter-js',
                    command: 'npm',
                    args: ['run', 'start-webpack'],
                },
                {
                    name: 'terminal:rollup-watch',
                    directory: 'src/terminal',
                    command: 'npx',
                    args: ['rollup', '-c', 'rollup.config.js', '--watch'],
                    env: {
                        PUTER_JS_URL: ({ global_config: config }) => config.origin + '/sdk/puter.dev.js',
                    }
                },
                {
                    name: 'phoenix:rollup-watch',
                    directory: 'src/phoenix',
                    command: 'npx',
                    args: ['rollup', '-c', 'rollup.config.js', '--watch'],
                    env: {
                        PUTER_JS_URL: ({ global_config: config }) => config.origin + '/sdk/puter.dev.js',
                    }
                },
                {
                    name: 'git:rollup-watch',
                    directory: 'src/git',
                    command: 'npx',
                    args: ['rollup', '-c', 'rollup.config.js', '--watch'],
                    env: {
                        PUTER_JS_URL: ({ global_config: config }) => config.origin + '/sdk/puter.dev.js',
                    }
                },
            ],
        });

        const { ServeStaticFilesService } = require("./services/ServeStaticFilesService");
        services.registerService('__serve-puterjs', ServeStaticFilesService, {
            directories: [
                {
                    prefix: '/sdk',
                    path: path_.resolve(__dirname, '../../../src/puter-js/dist'),
                },
                {
                    prefix: '/builtin/terminal',
                    path: path_.resolve(__dirname, '../../../src/terminal/dist'),
                },
                {
                    prefix: '/builtin/phoenix',
                    path: path_.resolve(__dirname, '../../../src/phoenix/dist'),
                },
                {
                    prefix: '/builtin/git',
                    path: path_.resolve(__dirname, '../../../src/git/dist'),
                },
            ],
        });
        
        const { ServeSingleFileService } = require('./services/ServeSingeFileService');
        services.registerService('__serve-puterjs-new', ServeSingleFileService, {
            path: path_.resolve(__dirname,
                '../../../src/puter-js/dist/puter.dev.js'),
            route: '/puter.js/v2',
        });
    }
}

module.exports = SelfHostedModule;
