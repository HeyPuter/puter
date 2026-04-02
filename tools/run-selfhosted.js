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

import LocalDiskStorageModule from '@heyputer/backend/src/LocalDiskStorageModule.js';
import process from 'node:process';

try {
    await import('dotenv/config');
} catch (e) {
    // dotenv is optional
}

// Annoying polyfill for inconsistency in different node versions
if ( ! import.meta.filename ) {
    Object.defineProperty(import.meta, 'filename', {
        get: () => import.meta.url.slice('file://'.length),
    });
}

const main = async () => {
    const {
        Kernel,
        EssentialModules,
        DatabaseModule,
        SelfHostedModule,
        BroadcastModule,
        TestDriversModule,
        TestConfigModule,
        PuterAIModule,
        InternetModule,
        DevelopmentModule,
        DNSModule,
    } = (await import('@heyputer/backend')).default;

    const k = new Kernel({
        entry_path: import.meta.filename,
    });
    for ( const mod of EssentialModules ) {
        k.add_module(new mod());
    }
    k.add_module(new DatabaseModule());
    k.add_module(new LocalDiskStorageModule());
    k.add_module(new SelfHostedModule());
    k.add_module(new BroadcastModule());
    k.add_module(new TestDriversModule());
    k.add_module(new TestConfigModule());
    k.add_module(new PuterAIModule());
    k.add_module(new InternetModule());
    k.add_module(new DNSModule());
    if ( process.env.UNSAFE_PUTER_DEV ) {
        k.add_module(new DevelopmentModule());
    }
    k.boot();
};

(async () => {
    await main();
})();
