// METADATA // {"ai-commented":{"service":"claude"}}
/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { AdvancedBase } = require("@heyputer/putility");
const Library = require("./definitions/Library");
const { NotificationES } = require("./om/entitystorage/NotificationES");
const { ProtectedAppES } = require("./om/entitystorage/ProtectedAppES");
const { Context } = require('./util/context');



/**
 * Core module for the Puter platform that includes essential services including
 * authentication, filesystems, rate limiting, permissions, and various API endpoints.
 * 
 * This is a monolithic module. Incrementally, services should be migrated to
 * Core2Module and other modules instead. Core2Module has a smaller scope, and each
 * new module will be a cohesive concern. Once CoreModule is empty, it will be removed
 * and Core2Module will take on its name.
 */
class CoreModule extends AdvancedBase {
    dirname () { return __dirname; }
    async install (context) {
        const services = context.get('services');
        const app = context.get('app');
        const useapi = context.get('useapi');
        const modapi = context.get('modapi');
        await install({ services, app, useapi, modapi });
    }

    /**
    * Installs legacy services that don't extend BaseService and require special handling.
    * These services were created before the BaseService class existed and don't listen
    * to the init event. They need to be installed after the init event is dispatched
    * due to initialization order dependencies.
    * 
    * @param {Object} context - The context object containing service references
    * @param {Object} context.services - Service registry for registering legacy services
    * @returns {Promise<void>} Resolves when legacy services are installed
    */
    async install_legacy (context) {
        const services = context.get('services');
        await install_legacy({ services });
    }
}

module.exports = CoreModule;

/**
 * @footgun - real install method is defined above
 */
const install = async ({ services, app, useapi, modapi }) => {
    const config = require('./config');


    // === LIBRARIES ===

    useapi.withuse(() => {
        def('Service', require('./services/BaseService'));
        def('Module', AdvancedBase);
        def('Library', Library);

        def('core.util.helpers', require('./helpers'));
        def('core.util.permission', require('./services/auth/PermissionService').PermissionUtil);
        def('puter.middlewares.auth', require('./middleware/auth2'));
        def('puter.middlewares.anticsrf', require('./middleware/anticsrf'));
        
        def('core.APIError', require('./api/APIError'));
        
        def('core', require('./services/auth/Actor'), { assign: true });
        def('core.config', config);
    });
    
    useapi.withuse(() => {
        const ArrayUtil = require('./libraries/ArrayUtil');
        services.registerService('util-array', ArrayUtil);
    
        const LibTypeTagged = require('./libraries/LibTypeTagged');
        services.registerService('lib-type-tagged', LibTypeTagged);
    });

    modapi.libdir('core.util', './util');
    
    // === SERVICES ===

    // /!\ IMPORTANT /!\
    // For new services, put the import immediately above the
    // call to services.registerService. We'll clean this up
    // in a future PR.

    const { CommandService } = require('./services/CommandService');
    const { HTTPThumbnailService } = require('./services/thumbnails/HTTPThumbnailService');
    const { PureJSThumbnailService } = require('./services/thumbnails/PureJSThumbnailService');
    const { NAPIThumbnailService } = require('./services/thumbnails/NAPIThumbnailService');
    const { DevConsoleService } = require('./services/DevConsoleService');
    const { RateLimitService } = require('./services/sla/RateLimitService');
    const { MonthlyUsageService } = require('./services/sla/MonthlyUsageService');
    const { AuthService } = require('./services/auth/AuthService');
    const { SLAService } = require('./services/sla/SLAService');
    const { PermissionService } = require('./services/auth/PermissionService');
    const { ACLService } = require('./services/auth/ACLService');
    const { CoercionService } = require('./services/drivers/CoercionService');
    const { PuterSiteService } = require('./services/PuterSiteService');
    const { ContextInitService } = require('./services/ContextInitService');
    const { IdentificationService } = require('./services/abuse-prevention/IdentificationService');
    const { AuthAuditService } = require('./services/abuse-prevention/AuthAuditService');
    const { RegistryService } = require('./services/RegistryService');
    const { RegistrantService } = require('./services/RegistrantService');
    const { SystemValidationService } = require('./services/SystemValidationService');
    const { EntityStoreService } = require('./services/EntityStoreService');
    const SQLES = require('./om/entitystorage/SQLES');
    const ValidationES = require('./om/entitystorage/ValidationES');
    const { SetOwnerES } = require('./om/entitystorage/SetOwnerES');
    const AppES = require('./om/entitystorage/AppES');
    const WriteByOwnerOnlyES = require('./om/entitystorage/WriteByOwnerOnlyES');
    const SubdomainES = require('./om/entitystorage/SubdomainES');
    const { MaxLimitES } = require('./om/entitystorage/MaxLimitES');
    const { AppLimitedES } = require('./om/entitystorage/AppLimitedES');
    const { ReadOnlyES } = require('./om/entitystorage/ReadOnlyES');
    const { OwnerLimitedES } = require('./om/entitystorage/OwnerLimitedES');
    const { ESBuilder } = require('./om/entitystorage/ESBuilder');
    const { Eq, Or } = require('./om/query/query');
    const { TrackSpendingService } = require('./services/TrackSpendingService');
    const { MakeProdDebuggingLessAwfulService } = require('./services/MakeProdDebuggingLessAwfulService');
    const { ConfigurableCountingService } = require('./services/ConfigurableCountingService');
    const { FSLockService } = require('./services/fs/FSLockService');
    const { StrategizedService } = require('./services/StrategizedService');
    const FilesystemAPIService = require('./services/FilesystemAPIService');
    const ServeGUIService = require('./services/ServeGUIService');
    const PuterAPIService = require('./services/PuterAPIService');
    const { RefreshAssociationsService } = require("./services/RefreshAssociationsService");
    // Service names beginning with '__' aren't called by other services;
    // these provide data/functionality to other services or produce
    // side-effects from the events of other services.

    // === Services which extend BaseService ===
    services.registerService('system-validation', SystemValidationService);
    services.registerService('commands', CommandService);
    services.registerService('__api-filesystem', FilesystemAPIService);
    services.registerService('__api', PuterAPIService);
    services.registerService('__gui', ServeGUIService);
    services.registerService('registry', RegistryService);
    services.registerService('__registrant', RegistrantService);
    services.registerService('fslock', FSLockService);
    services.registerService('es:app', EntityStoreService, {
        entity: 'app',
        upstream: ESBuilder.create([
            SQLES, { table: 'app', debug: true, },
            AppES,
            AppLimitedES, {
                // When apps query es:apps, they're allowed to see apps which
                // are approved for listing and they're allowed to see their
                // own entry.
                exception: async () => {
                    const actor = Context.get('actor');
                    return new Or({
                        children: [
                            new Eq({
                                key: 'approved_for_listing',
                                value: 1,
                            }),
                            new Eq({
                                key: 'uid',
                                value: actor.type.app.uid,
                            }),
                        ]
                    });
                },
            },
            WriteByOwnerOnlyES,
            ValidationES,
            SetOwnerES,
            ProtectedAppES,
            MaxLimitES, { max: 5000 },
        ]),
    });

    const { InformationService } = require('./services/information/InformationService');
    services.registerService('information', InformationService)
    
    const { FilesystemService } = require('./filesystem/FilesystemService');
    services.registerService('filesystem', FilesystemService);

    services.registerService('es:subdomain', EntityStoreService, {
        entity: 'subdomain',
        upstream: ESBuilder.create([
            SQLES, { table: 'subdomains', debug: true, },
            SubdomainES,
            AppLimitedES,
            WriteByOwnerOnlyES,
            ValidationES,
            SetOwnerES,
            MaxLimitES, { max: 5000 },
        ]),
    });
    services.registerService('es:notification', EntityStoreService, {
        entity: 'notification',
        upstream: ESBuilder.create([
            SQLES, { table: 'notification', debug: true },
            NotificationES,
            OwnerLimitedES,
            ReadOnlyES,
            SetOwnerES,
            MaxLimitES, { max: 200 },
        ]),
    })
    services.registerService('rate-limit', RateLimitService);
    services.registerService('monthly-usage', MonthlyUsageService);
    services.registerService('auth', AuthService);
    services.registerService('permission', PermissionService);
    services.registerService('sla', SLAService);
    services.registerService('acl', ACLService);
    services.registerService('coercion', CoercionService);
    services.registerService('puter-site', PuterSiteService);
    services.registerService('context-init', ContextInitService);
    services.registerService('identification', IdentificationService);
    services.registerService('auth-audit', AuthAuditService);
    services.registerService('spending', TrackSpendingService);
    services.registerService('counting', ConfigurableCountingService);
    services.registerService('thumbnails', StrategizedService, {
        strategy_key: 'engine',
        default_strategy: 'purejs',
        strategies: {
            napi: [NAPIThumbnailService],
            purejs: [PureJSThumbnailService],
            http: [HTTPThumbnailService],
        }
    });
    services.registerService('__refresh-assocs', RefreshAssociationsService);
    services.registerService('__prod-debugging', MakeProdDebuggingLessAwfulService);
    if ( config.env == 'dev' ) {
        services.registerService('dev-console', DevConsoleService);
    }

    const { EventService } = require('./services/EventService');
    services.registerService('event', EventService);

    const { PuterVersionService } = require('./services/PuterVersionService');
    services.registerService('puter-version', PuterVersionService);

    const { SessionService } = require('./services/SessionService');
    services.registerService('session', SessionService);

    const { EdgeRateLimitService } = require('./services/abuse-prevention/EdgeRateLimitService');
    services.registerService('edge-rate-limit', EdgeRateLimitService);

    const { CleanEmailService } = require('./services/CleanEmailService');
    services.registerService('clean-email', CleanEmailService);

    const { Emailservice } = require('./services/EmailService');
    services.registerService('email', Emailservice);

    const { TokenService } = require('./services/auth/TokenService');
    services.registerService('token', TokenService);

    const { OTPService } = require('./services/auth/OTPService');
    services.registerService('otp', OTPService);

    const { UserProtectedEndpointsService } = require("./services/web/UserProtectedEndpointsService");
    services.registerService('__user-protected-endpoints', UserProtectedEndpointsService);

    const { AntiCSRFService } = require('./services/auth/AntiCSRFService');
    services.registerService('anti-csrf', AntiCSRFService);

    const { LockService } = require('./services/LockService');
    services.registerService('lock', LockService);

    const { PuterHomepageService } = require('./services/PuterHomepageService');
    services.registerService('puter-homepage', PuterHomepageService);

    const { GetUserService } = require('./services/GetUserService');
    services.registerService('get-user', GetUserService);

    const { DetailProviderService } = require('./services/DetailProviderService');
    services.registerService('whoami', DetailProviderService);

    const { DevTODService } = require('./services/DevTODService');
    services.registerService('__dev-tod', DevTODService);

    const { DriverService } = require("./services/drivers/DriverService");
    services.registerService('driver', DriverService);

    const { ScriptService } = require('./services/ScriptService');
    services.registerService('script', ScriptService);
    
    const { NotificationService } = require('./services/NotificationService');
    services.registerService('notification', NotificationService);

    const { ProtectedAppService } = require('./services/ProtectedAppService');
    services.registerService('__protected-app', ProtectedAppService);

    const { ShareService } = require('./services/ShareService');
    services.registerService('share', ShareService);
    
    const { GroupService } = require('./services/auth/GroupService');
    services.registerService('group', GroupService);

    const { VirtualGroupService } = require('./services/auth/VirtualGroupService');
    services.registerService('virtual-group', VirtualGroupService);
    
    const { PermissionAPIService } = require('./services/PermissionAPIService');
    services.registerService('__permission-api', PermissionAPIService);

    const { MountpointService } = require('./services/MountpointService');
    services.registerService('mountpoint', MountpointService);

    const { AnomalyService } = require('./services/AnomalyService');
    services.registerService('anomaly', AnomalyService);
    
    const { HelloWorldService } = require('./services/HelloWorldService');
    services.registerService('hello-world', HelloWorldService);
    
    const { SystemDataService } = require('./services/SystemDataService');
    services.registerService('system-data', SystemDataService);
    
    const { SUService } = require('./services/SUService');
    services.registerService('su', SUService);

    const { ShutdownService } = require('./services/ShutdownService');
    services.registerService('shutdown', ShutdownService);

    const { BootScriptService } = require('./services/BootScriptService');
    services.registerService('boot-script', BootScriptService);

    const { FeatureFlagService } = require('./services/FeatureFlagService');
    services.registerService('feature-flag', FeatureFlagService);

    const { KernelInfoService } = require('./services/KernelInfoService');
    services.registerService('kernel-info', KernelInfoService);

    const { DriverUsagePolicyService } = require('./services/drivers/DriverUsagePolicyService');
    services.registerService('driver-usage-policy', DriverUsagePolicyService);

    const { CommentService } = require('./services/CommentService');
    services.registerService('comment', CommentService);

    const { ReferralCodeService } = require('./services/ReferralCodeService');
    services.registerService('referral-code', ReferralCodeService);
    
    const { UserService } = require('./services/UserService');
    services.registerService('user', UserService);

    const { WSPushService } = require('./services/WSPushService');
    services.registerService('__event-push-ws', WSPushService);
}

const install_legacy = async ({ services }) => {
    const PerformanceMonitor = require('./monitor/PerformanceMonitor');
    const { OperationTraceService } = require('./services/OperationTraceService');
    const { ClientOperationService } = require('./services/ClientOperationService');
    const { EngPortalService } = require('./services/EngPortalService');
    const { AppInformationService } = require('./services/AppInformationService');
    const { FileCacheService } = require('./services/file-cache/FileCacheService');

    // === Services which do not yet extend BaseService ===
    // services.registerService('filesystem', FilesystemService);
    services.registerService('operationTrace', OperationTraceService);
    services.registerService('file-cache', FileCacheService);
    services.registerService('client-operation', ClientOperationService);
    services.registerService('app-information', AppInformationService);
    services.registerService('engineering-portal', EngPortalService);

    // This singleton was made before services existed,
    // so we have to pass that to it manually
    PerformanceMonitor.provideServices(services);

};
