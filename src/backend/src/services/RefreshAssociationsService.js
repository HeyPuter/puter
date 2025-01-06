// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const { Context } = require("../util/context");
const BaseService = require("./BaseService");


/**
* Class RefreshAssociationsService
* 
* This class is responsible for managing the refresh of associations in the system.
* It extends the BaseService and provides methods to handle the refreshing operations
* with context fallback capabilities to ensure reliability during the execution of tasks.
*/
class RefreshAssociationsService extends BaseService {
    /**
     * Executes the consolidation process to refresh the associations cache.
     * This method is triggered on the '__on_boot.consolidation' event and
     * ensures that the cache is updated periodically. The first update occurs
     * after a delay of 15 seconds, followed by continuous updates every 30 seconds.
     * 
     * @async
     * @returns {Promise<void>} - A promise that resolves when the cache refresh process is complete.
     */
    async ['__on_boot.consolidation'] () {
        const { refresh_associations_cache } = require('../helpers');


        /**
        * Executes the consolidation process on boot, refreshing the associations cache.
        * This method invokes the `refresh_associations_cache` function within a fallback context.
        * The cache refresh is scheduled to run every 30 seconds after an initial delay of 15 seconds.
        */
        await Context.allow_fallback(async () => {
            refresh_associations_cache();
        });
        /**
        * Executes the refresh associations cache function within a fallback context.
        * This method ensures that the cache is refreshed properly, handling any
        * potential errors that may occur during execution. It utilizes the Context
        * utility to allow error handling without interrupting the main application flow.
        */
        setTimeout(() => {
            /**
             * Schedules periodic refresh of associations cache after a timeout.
             * 
             * This method initiates a cache refresh operation that is run at a specified interval.
             * The initial refresh occurs after a delay, followed by regular refreshes every 30 seconds.
             * 
             * @returns {Promise<void>} A promise that resolves when the refresh process starts.
             */
            setInterval(async () => {
                /**
                * Initializes a periodic refresh of associations in the cache.
                * The method sets a timeout before starting an interval that calls
                * the `refresh_associations_cache` function every 30 seconds.
                * 
                * @returns {void}
                */
                await Context.allow_fallback(async () => {
                    await refresh_associations_cache();
                })
            }, 30000);
        }, 15000)
    }
}

module.exports = { RefreshAssociationsService };
