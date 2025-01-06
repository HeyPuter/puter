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

const BaseService = require("../../services/BaseService");
const { PuterFSProvider } = require("./lib/PuterFSProvider");

class PuterFSService extends BaseService {
    async _init () {
        const svc_mountpoint = this.services.get('mountpoint');
        svc_mountpoint.register_mounter('puterfs', this.as('mounter'));
    }

    static IMPLEMENTS = {
        mounter: {
            async mount ({ path, options }) {
                const provider = new PuterFSProvider();
                return provider;
            }
        }
    }
}

module.exports = {
    PuterFSService,
};