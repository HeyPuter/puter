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
const eggspress = require("../api/eggspress");

module.exports = eggspress(['/version'], {
    allowedMethods: ['GET'],
    subdomain: 'api',
    json: true,
}, async (req, res, next) => {
    const svc_puterVersion = req.services.get('puter-version');

    const response = svc_puterVersion.get_version();

    // Add user-friendly version information
    {
        response.version_text = response.version;
        const components = response.version.split('-');
        if ( components.length > 1 ) {
            response.release_type = components[1];
            if ( components[1] === 'rc' ) {
                response.version_text =
                    `${components[0]} (Release Candidate ${components[2]})`;
            }
            else if ( components[1] === 'dev' ) {
                response.version_text =
                    `${components[0]} (Development Build)`;
            }
            else if ( components[1] === 'beta' ) {
                response.version_text =
                    `${components[0]} (Beta Release)`;
            }
            else if ( ! isNaN(components[1]) ) {
                response.version_text = `${components[0]} (Build ${components[1]})`;
                response.sub_version = components[1];
                response.hash = components[2];
                response.release_type = 'build';
            }
            if ( isNaN(components[1]) && components.length > 2 ) {
                response.sub_version = components[2];
            }
        }
    }

    res.send(response);
});
