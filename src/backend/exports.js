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
import CoreModule from './src/CoreModule.js';
import DatabaseModule from './src/DatabaseModule.js';
import { testlaunch } from './src/index.js';
import { Kernel } from './src/Kernel.js';
import LocalDiskStorageModule from './src/LocalDiskStorageModule.js';
import MemoryStorageModule from './src/MemoryStorageModule.js';
import { PuterAIModule } from './src/modules/ai/PuterAIChatModule.js';
import { AppsModule } from './src/modules/apps/AppsModule.js';
import { BroadcastModule } from './src/modules/broadcast/BroadcastModule.js';
import { CaptchaModule } from './src/modules/captcha/CaptchaModule.js';
import { Core2Module } from './src/modules/core/Core2Module.js';
import { DataAccessModule } from './src/modules/data-access/DataAccessModule.js';
import { DevelopmentModule } from './src/modules/development/DevelopmentModule.js';
import { DNSModule } from './src/modules/dns/DNSModule.js';
import { DomainModule } from './src/modules/domain/DomainModule.js';
import { EntityStoreModule } from './src/modules/entitystore/EntityStoreModule.js';
import { HostOSModule } from './src/modules/hostos/HostOSModule.js';
import { InternetModule } from './src/modules/internet/InternetModule.js';
import { KVStoreModule } from './src/modules/kvstore/KVStoreModule.js';
import { PuterFSModule } from './src/modules/puterfs/PuterFSModule.js';
import SelfHostedModule from './src/modules/selfhosted/SelfHostedModule.js';
import { TestConfigModule } from './src/modules/test-config/TestConfigModule.js';
import { TestDriversModule } from './src/modules/test-drivers/TestDriversModule.js';
import { WebModule } from './src/modules/web/WebModule.js';
import BaseService from './src/services/BaseService.js';
import { Context } from './src/util/context.js';

export default {
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
        // TemplateModule,
        AppsModule,
        CaptchaModule,
        EntityStoreModule,
        KVStoreModule,
        DataAccessModule,
    ],

    // Pre-built modules
    CoreModule,
    WebModule,
    DatabaseModule,
    LocalDiskStorageModule,
    MemoryStorageModule,
    SelfHostedModule,
    TestDriversModule,
    TestConfigModule,
    PuterAIModule,
    BroadcastModule,
    InternetModule,
    CaptchaModule,
    KVStoreModule,
    DNSModule,
    DomainModule,

    // Development modules
    DevelopmentModule,
};
