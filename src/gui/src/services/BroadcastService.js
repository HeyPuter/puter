/**
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

import { Service } from "../definitions.js";

export class BroadcastService extends Service {
    // After a new app is launched, it will receive these broadcasts
    #broadcastsToSendToNewAppInstances = new Map(); // name -> data

    async _init() {
        // Nothing
    }

    // Send a 'broadcast' message to all open apps, with the given name and data.
    // If sendToNewAppInstances is true, the message will be saved, and sent to any apps that are launched later.
    // A new saved broadcast will replace an earlier one with the same name.
    sendBroadcast(name, data, { sendToNewAppInstances = false } = {}) {
        $('.window-app-iframe[data-appUsesSDK=true]').each((_, iframe) => {
            iframe.contentWindow.postMessage({
                msg: 'broadcast',
                name: name,
                data: data,
            }, '*');
        });

        if (sendToNewAppInstances) {
            this.#broadcastsToSendToNewAppInstances.set(name, data);
        }
    }

    // Send all saved broadcast messages to the given app instance.
    sendSavedBroadcastsTo(appInstanceID) {
        const iframe = $(`.window[data-element_uuid="${appInstanceID}"] .window-app-iframe[data-appUsesSDK=true]`).get(0);
        if (!iframe) {
            console.error(`Attempted to send saved broadcasts to app instance ${appInstanceID}, which is not using the Puter SDK`);
            return;
        }
        for (const [name, data] of this.#broadcastsToSendToNewAppInstances) {
            iframe.contentWindow.postMessage({
                msg: 'broadcast',
                name: name,
                data: data,
            }, '*');
        }
    }
}
