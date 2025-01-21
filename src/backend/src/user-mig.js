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
"use strict"
const db = require('./db/mysql.js')
const { mkdir } = require('./helpers');

(async function() {
    // get users
    const [users] = await db.promise().execute( `SELECT * FROM user`);

    // for each user ...
    for(let i=0; i<users.length; i++){
        const user = users[i];
        // *** user actions go here:
        try{
            let dir = await mkdir({
                path: '/' + user.username + '/Trash',
                user: user,
                immutable: true,
                overwrite: true,
                return_id: true,
            });
        }catch(e){
            console.log(e)
        }
    }
    console.log('Done');
    return;
})();
