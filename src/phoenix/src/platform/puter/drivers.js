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
export const CreateDriversProvider = ({
    puterSDK
}) => {
    return {
        call: async (params) => {
            console.log('the puterSDK', puterSDK);
            const resp = await fetch(
                `${puterSDK.APIOrigin}/drivers/call`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${puterSDK.authToken}`
                    },
                    body: JSON.stringify({
                        ...params,
                    }),
                }
            );
    
            return await resp.blob();
        },
        usage: async () => {
            const resp = await fetch(
                `${puterSDK.APIOrigin}/drivers/usage`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${puterSDK.authToken}`
                    },
                }
            );

            return await resp.json();                        
        }
    }
};
