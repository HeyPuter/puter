const { AdvancedBase } = require("@heyputer/putility");

class AppsModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { AppInformationService } = require('./AppInformationService');
        services.registerService('app-information', AppInformationService);

        const { AppIconService } = require('./AppIconService');
        services.registerService('app-icon', AppIconService);

        const { OldAppNameService } = require('./OldAppNameService');
        services.registerService('old-app-name', OldAppNameService);

        const { ProtectedAppService } = require('./ProtectedAppService');
        services.registerService('__protected-app', ProtectedAppService);

        const RecommendedAppsService = require('./RecommendedAppsService');
        services.registerService('recommended-apps', RecommendedAppsService);
    }
}

module.exports = {
    AppsModule
};
