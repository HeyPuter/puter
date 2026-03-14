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

import { Endpoint } from '../util/expressutil.js';
import BaseService from './BaseService.js';

export class PeerService extends BaseService {
    '__on_install.routes' (_, { app }) {
        Endpoint({
            route: '/peer/signaller-info',
            methods: ['GET'],
            handler: async (req, res) => {
                res.json({
                    url: this.config.signaller_url,
                });
            },
        }).attach(app);
    }
}
