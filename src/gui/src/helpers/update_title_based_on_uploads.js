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

const update_title_based_on_uploads = function(){
    const active_uploads_count = _.size(window.active_uploads);
    if(active_uploads_count === 1 && !isNaN(Object.values(window.active_uploads)[0])){
        document.title = Math.round(Object.values(window.active_uploads)[0]) + '% Uploading';
    }else if(active_uploads_count > 1){
        // get the average progress
        let total_progress = 0;
        for (const [key, value] of Object.entries(window.active_uploads)) {
            total_progress += Math.round(value);
        }
        const avgprog = Math.round(total_progress / active_uploads_count)
        if(!isNaN(avgprog))
            document.title = avgprog + '% Uploading';
    }
}

export default update_title_based_on_uploads;