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
import * as utils from '../lib/utils.js'

class Email{
    /**
     * Creates a new instance with the given authentication token, API origin, and app ID,
     *
     * @class
     * @param {string} authToken - Token used to authenticate the user.
     * @param {string} APIOrigin - Origin of the API server. Used to build the API endpoint URLs.
     * @param {string} appID - ID of the app to use.
     */
    constructor (authToken, APIOrigin, appID) {
        this.authToken = authToken;
        this.APIOrigin = APIOrigin;
        this.appID = appID;
    }

    /**
     * Sets a new authentication token.
     *
     * @param {string} authToken - The new authentication token.
     * @memberof [Email]
     * @returns {void}
     */
    setAuthToken (authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     * 
     * @param {string} APIOrigin - The new API origin.
     * @memberof [Email]
     * @returns {void}
     */
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    send = async(...args) => {
        let options = {};

        // arguments are required
        if(!args || args.length === 0){
            throw ({message: 'Arguments are required', code: 'arguments_required'});
        }

        if(typeof args[0] === 'object'){
            options = args[0];
        }else{
            options = {
                to: args[0],
                subject: args[1],
                html: args[2]
            }
        }

        return utils.make_driver_method(['to', 'subject', 'html'], 'temp-email', 'send').call(this, options);
    }
}

export default Email