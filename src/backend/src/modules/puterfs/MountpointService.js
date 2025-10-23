// METADATA // {"ai-commented":{"service":"claude"}}
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
const { RootNodeSelector, NodeUIDSelector, NodeChildSelector, NodePathSelector, try_infer_attributes } = require("../../filesystem/node/selectors");
const BaseService = require("../../services/BaseService");

/**
 * This will eventually be a service which manages the storage
 * backends for mountpoints.
 *
 * For the moment, this is a way to access the storage backend
 * in situations where ContextInitService isn't able to
 * initialize a context.
 */

/**
* @class MountpointService
* @extends BaseService
* @description Service class responsible for managing storage backends for mountpoints.
* Currently provides a temporary solution for accessing storage backend when context
* initialization is not possible. Will be expanded to handle multiple mountpoints
* and their associated storage backends in future implementations.
*/
class MountpointService extends BaseService {

    #storage = {};
    #mounters = {};
    #mountpoints = {};

    register_mounter(name, mounter) {
        this.#mounters[name] = mounter;
    }

    async ['__on_boot.consolidation']() {
        const mountpoints = this.config.mountpoints ?? {
            '/': {
                mounter: 'puterfs',
            },
        };

        for ( const path of Object.keys(mountpoints) ) {
            const { mounter: mounter_name, options } =
                mountpoints[path];
            const mounter = this.#mounters[mounter_name];
            const provider = await mounter.mount({
                path,
                options,
            });
            this.#mountpoints[path] = {
                provider,
            };
        }

        this.services.emit('filesystem.ready', {
            mountpoints: Object.keys(this.#mountpoints),
        });
    }

    async get_provider(selector) {
        // If there is only one provider, we don't need to do any of this,
        // and that's a big deal because the current implementation requires
        // fetching a filesystem entry before we even have operation-level
        // transient memoization instantiated.
        if ( Object.keys(this.#mountpoints).length === 1 ) {
            return Object.values(this.#mountpoints)[0].provider;
        }

        try_infer_attributes(selector);

        if ( selector instanceof RootNodeSelector ) {
            return this.#mountpoints['/'].provider;
        }

        if ( selector instanceof NodeUIDSelector ) {
            for ( const { provider } of Object.values(this.#mountpoints) ) {
                const result = await provider.quick_check({
                    selector,
                });
                if ( result ) {
                    return provider;
                }
            }

            // No provider found, but we shouldn't throw an error here
            // because it's a valid case for a node that doesn't exist.
        }

        if ( selector instanceof NodeChildSelector ) {
            if ( selector.path ) {
                return this.get_provider(new NodePathSelector(selector.path));
            } else {
                return this.get_provider(selector.parent);
            }
        }

        const probe = {};
        selector.setPropertiesKnownBySelector(probe);
        if ( probe.path ) {
            let longest_mount_path = '';
            for ( const path of Object.keys(this.#mountpoints) ) {
                if ( ! probe.path.startsWith(path) ) {
                    continue;
                }
                if ( path.length > longest_mount_path.length ) {
                    longest_mount_path = path;
                }
            }

            if ( longest_mount_path ) {
                return this.#mountpoints[longest_mount_path].provider;
            }
        }

        // Use root mountpoint as fallback
        return this.#mountpoints['/'].provider;
    }

    // Temporary solution - we'll develop this incrementally
    set_storage(provider, storage) {
        this.#storage[provider] = storage;
    }

    /**
    * Gets the current storage backend instance
    * @returns {Object} The storage backend instance
    */
    get_storage(provider) {
        const storage = this.#storage[provider];
        if ( ! storage ) {
            throw new Error(`MountpointService.get_storage: storage for provider "${provider}" not found`);
        }
        return storage;
    }
}

module.exports = {
    MountpointService,
};
