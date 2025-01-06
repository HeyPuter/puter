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
const { BaseService } = require("../../../exports");
const { surrounding_box } = require("../../fun/dev-console-ui-utils");

class ComplainAboutVersionsService extends BaseService {
    static DESCRIPTION = `
        This service doesn't mandate a specific version of node.js,
        but it will complain (create a sticky notification in the
        dev console) if you're using something that's past EOL.

        This is mostly just for fun, because it feels cool when the
        system calls people out for using old versions of node.
        That said, maybe one day we'll come across some nuanced error
        that only happens an a recently EOL'd node version.
    `;

    static MODULES = {
        axios: require('axios'),
    }

    async _init () {
        const eol_data = await this.get_eol_data_();

        const [major] = process.versions.node.split('.');
        const current_version_data = eol_data.find(
            ({ cycle }) => cycle === major
        );

        if ( ! current_version_data ) {
            this.log.warn(
                `failed to check ${major} in the EOL database`
            );
            return;
        }

        const eol_date = new Date(current_version_data.eol);
        const cur_date_obj = new Date();

        if ( cur_date_obj < eol_date ) {
            this.log.info('node.js version looks good');
            return;
        }

        let timeago = (() => {
            let years = cur_date_obj.getFullYear() - eol_date.getFullYear();
            let months = cur_date_obj.getMonth() - eol_date.getMonth();
            
            let str = '';
            while ( years > 0 ) {
                years -= 1;
                months += 12;
            }
            if ( months > 0 ) {
                str += `at least ${months} month${months > 1 ? 's' : ''}`;
            } else {
                str += `a few days`;
            }
            return str;
        })();

        const svc_devConsole = this.services.get('dev-console');
        svc_devConsole.add_widget(() => {
            const widget_lines = [];
            widget_lines.push(
                `Node.js version ${major} is past EOL by ${timeago};`,
                `Everything should work, but you should still upgrade.`,
            );
            surrounding_box('31;1', widget_lines);
            return widget_lines;
        });
    }

    async get_eol_data_ () {
        const require = this.require;
        const axios = require('axios');
        const url = 'https://endoflife.date/api/nodejs.json'
        let data;
        try {
            ({ data } = await axios.get(url));
            return data;
        } catch (e) {
            this.log.error(e);
            return [];
        }
    }
}

module.exports = ComplainAboutVersionsService;
