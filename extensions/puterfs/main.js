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

import FSEntryController from './fsentries/FSEntryController.js';
import PuterFSProvider from './PuterFSProvider.js';
import LocalDiskStorageController from './storage/LocalDiskStorageController.js';
import ProxyStorageController from './storage/ProxyStorageController.js';

const svc_event = extension.import('service:event');

const fsEntryController = new FSEntryController();
const storageController = new ProxyStorageController();

extension.on('init', async () => {
    fsEntryController.init();

    // Keep track of possible storage strategies for puterfs here
    let defaultStorage = 'flat-files';
    const storageStrategies = {
        'flat-files': new LocalDiskStorageController(),
    };

    // Emit the "create storage strategies" event
    const event = {
        createStorageStrategy (name, implementation) {
            storageStrategies[name] = implementation;
            if ( implementation === undefined ) {
                throw new Error('createStorageStrategy was called wrong');
            }
            if ( implementation.forceDefault ) {
                defaultStorage = name;
            }
        },
    };
    // Awaiting the event ensures all the storage strategies are registered
    await svc_event.emit('puterfs.storage.create', event);

    let configuredStorage = defaultStorage;
    if ( config.storage ) configuredStorage = config.storage;

    // Not we can select the configured strategy
    const storageToUse = storageStrategies[configuredStorage];
    storageController.setDelegate(storageToUse);

    // The StorageController may need to await some asynchronous operations
    // before it's ready to be used.
    await storageController.init();

});

extension.on('create.filesystem-types', event => {
    event.createFilesystemType('puterfs', {
        mount ({ path }) {
            return new PuterFSProvider({
                fsEntryController,
                storageController,
            });
        },
    });
});
