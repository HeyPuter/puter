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

/**
 * Maps a MIME/Content Type to the appropriate icon.
 * 
 * @param {*} type 
 * @returns 
 */
const content_type_to_icon = (type)=>{
    let icon;
    if(type === null)
        icon = 'file.svg';
    else if(type.startsWith('text/plain'))
        icon = 'file-text.svg'
    else if(type.startsWith('text/html'))
        icon = 'file-html.svg'
    else if(type.startsWith('text/markdown'))
        icon = 'file-md.svg'
    else if(type.startsWith('text/xml'))
        icon = 'file-xml.svg'
    else if(type.startsWith('application/json'))
        icon = 'file-json.svg'
    else if(type.startsWith('application/javascript'))
        icon = 'file-js.svg'
    else if(type.startsWith('application/pdf'))
        icon = 'file-pdf.svg'
    else if(type.startsWith('application/xml'))
        icon = 'file-xml.svg'
    else if(type.startsWith('application/x-httpd-php'))
        icon = 'file-php.svg'
    else if(type.startsWith('application/zip'))
        icon = 'file-zip.svg'
    else if(type.startsWith('text/css'))
        icon = 'file-css.svg'
	else if(type.startsWith('font/ttf'))
        icon = 'file-ttf.svg'
	else if(type.startsWith('font/otf'))
        icon = 'file-otf.svg'
	else if(type.startsWith('text/csv'))
        icon = 'file-csv.svg'
    else if(type.startsWith('image/svg'))
        icon = 'file-svg.svg'
    else if(type.startsWith('image/vnd.adobe.photoshop'))
        icon = 'file-psd.svg'
    else if(type.startsWith('image'))
        icon = 'file-image.svg'
    else if(type.startsWith('audio/'))
        icon = 'file-audio.svg'
    else if(type.startsWith('video'))
        icon = 'file-video.svg'
    else
        icon = 'file.svg';

    return window.icons[icon];
}

export default content_type_to_icon;