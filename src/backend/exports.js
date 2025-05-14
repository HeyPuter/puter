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
const CoreModule = require("./src/CoreModule.js");
const { Kernel } = require("./src/Kernel.js");
const DatabaseModule = require("./src/DatabaseModule.js");
const LocalDiskStorageModule = require("./src/LocalDiskStorageModule.js");
const SelfHostedModule = require("./src/modules/selfhosted/SelfHostedModule.js");
const { testlaunch } = require("./src/index.js");
const BaseService = require("./src/services/BaseService.js");
const { Context } = require("./src/util/context.js");
const { TestDriversModule } = require("./src/modules/test-drivers/TestDriversModule.js");
const { PuterAIModule } = require("./src/modules/puterai/PuterAIModule.js");
const { BroadcastModule } = require("./src/modules/broadcast/BroadcastModule.js");
const { WebModule } = require("./src/modules/web/WebModule.js");
const { Core2Module } = require("./src/modules/core/Core2Module.js");
const { TemplateModule } = require("./src/modules/template/TemplateModule.js");
const { PuterFSModule } = require("./src/modules/puterfs/PuterFSModule.js");
const { PerfMonModule } = require("./src/modules/perfmon/PerfMonModule.js");
const { AppsModule } = require("./src/modules/apps/AppsModule.js");
const { DevelopmentModule } = require("./src/modules/development/DevelopmentModule.js");
const { HostOSModule } = require("./src/modules/hostos/HostOSModule.js");
const { InternetModule } = require("./src/modules/internet/InternetModule.js");
const { CaptchaModule } = require("./src/modules/captcha/CaptchaModule.js");
const { EntityStoreModule } = require("./src/modules/entitystore/EntityStoreModule.js");
const { KVStoreModule } = require("./src/modules/kvstore/KVStoreModule.js");
const { ExternalExtrasModule } = require("./src/modules/external-extras/ExternalExtrasModule.js");
const { FirebaseModule } = require("./src/modules/firebase/FirebaseModule.js");
const { DomainModule } = require("./src/modules/domain/DomainModule.js");
const { DNSModule } = require("./src/modules/dns/DNSModule.js");

module.exports = {
    helloworld: () => {
        console.log('Hello, World!');
        process.exit(0);
    },
    testlaunch,

    // Kernel API
    BaseService,
    Context,

    Kernel,
    
    EssentialModules: [
        Core2Module,
        PuterFSModule,
        HostOSModule,
        CoreModule,
        WebModule,
        TemplateModule,
        AppsModule,
        CaptchaModule,
        EntityStoreModule,
        KVStoreModule,
        DomainModule,
    ],

    // Pre-built modules
    CoreModule,
    WebModule,
    DatabaseModule,
    LocalDiskStorageModule,
    SelfHostedModule,
    TestDriversModule,
    PuterAIModule,
    BroadcastModule,
    InternetModule,
    CaptchaModule,
    KVStoreModule,
    FirebaseModule,
    DNSModule,
    
    // Development modules
    PerfMonModule,
    DevelopmentModule,
};
