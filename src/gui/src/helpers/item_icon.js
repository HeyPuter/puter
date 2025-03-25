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

import mime from "../lib/mime.js";
import content_type_to_icon from './content_type_to_icon.js';

/**
 * Assigns an icon to a filesystem entry based on its properties such as name, type, 
 * and whether it's a directory, app, trashed, or specific file type.
 * 
 * @function item_icon
 * @global
 * @async
 * @param {Object} fsentry - A filesystem entry object. It may contain various properties 
 * like name, type, path, associated_app, thumbnail, is_dir, and metadata, depending on 
 * the type of filesystem entry.
 */

const item_icon = async (fsentry)=>{
    // --------------------------------------------------
    // If this file is Trashed then set the name to the original name of the file before it was trashed
    // --------------------------------------------------
    if(fsentry.path?.startsWith(window.trash_path + '/')){
        if(fsentry.metadata){
            try{
                let metadata = JSON.parse(fsentry.metadata);
                fsentry.name = (metadata && metadata.original_name) ? metadata.original_name : fsentry.name
            }
            catch(e){
                // Ignored
            }
        }
    }
    // --------------------------------------------------
    // thumbnail
    // --------------------------------------------------
    if(fsentry.thumbnail){
        // if thumbnail but a directory under AppData, then it's a thumbnail for an app and must be treated as an icon
        if(fsentry.path.startsWith(window.appdata_path + '/'))
            return {image: fsentry.thumbnail, type: 'icon'};
        // otherwise, it's a thumbnail for a file
        return {image: fsentry.thumbnail, type: 'thumb'};
    }
    // --------------------------------------------------
    // app icon
    // --------------------------------------------------
    else if(fsentry.associated_app && fsentry.associated_app?.name){
        if(fsentry.associated_app.icon)
            return {image: fsentry.associated_app.icon, type: 'icon'};
        else
            return {image: window.icons['app.svg'], type: 'icon'};
    }
    // --------------------------------------------------
    // Trash
    // --------------------------------------------------
    else if(fsentry.shortcut_to_path && fsentry.shortcut_to_path === window.trash_path){
        // get trash image, this is needed to get the correct empty vs full trash icon
        let trash_img = $(`.item[data-path="${html_encode(window.trash_path)}" i] .item-icon-icon`).attr('src')
        // if trash_img is undefined that's probably because trash wasn't added anywhere, do a direct lookup to see if trash is empty or no
        if(!trash_img){
            let trashstat = await puter.fs.stat(window.trash_path);
            if(trashstat.is_empty !== undefined && trashstat.is_empty === true)
                trash_img = window.icons['trash.svg'];
            else
                trash_img = window.icons['trash-full.svg'];
        }
        return {image: trash_img, type: 'icon'};
    }
    // --------------------------------------------------
    // Directories
    // --------------------------------------------------
    else if(fsentry.is_dir){
        // System Directories
        if(fsentry.path === window.docs_path)
            return {image: window.icons['folder-documents.svg'], type: 'icon'};
        else if (fsentry.path === window.pictures_path)
            return { image: window.icons['folder-pictures.svg'], type: 'icon' };
        else if (fsentry.path === window.home_path)
            return { image: window.icons['folder-home.svg'], type: 'icon' };
        else if (fsentry.path === window.videos_path)
            return { image: window.icons['folder-videos.svg'], type: 'icon' };
        else if (fsentry.path === window.desktop_path)
            return { image: window.icons['folder-desktop.svg'], type: 'icon' };
        else if (fsentry.path === window.public_path)
            return { image: window.icons['folder-public.svg'], type: 'icon' };
        // regular directories
        else
            return {image: window.icons['folder.svg'], type: 'icon'};
    }
    // --------------------------------------------------
    // Match icon by file extension
    // --------------------------------------------------
    // *.doc
    else if(fsentry.name.toLowerCase().endsWith('.doc')){
        return {image: window.icons['file-doc.svg'], type: 'icon'};
    }
    // *.docx
    else if(fsentry.name.toLowerCase().endsWith('.docx')){
        return {image: window.icons['file-docx.svg'], type: 'icon'};
    }
    // *.exe
    else if(fsentry.name.toLowerCase().endsWith('.exe')){
        return {image: window.icons['file-exe.svg'], type: 'icon'};
    }
    // *.gz
    else if(fsentry.name.toLowerCase().endsWith('.gz')){
        return {image: window.icons['file-gzip.svg'], type: 'icon'};
    }
    // *.jar
    else if(fsentry.name.toLowerCase().endsWith('.jar')){
        return {image: window.icons['file-jar.svg'], type: 'icon'};
    }
    // *.java
    else if(fsentry.name.toLowerCase().endsWith('.java')){
        return {image: window.icons['file-java.svg'], type: 'icon'};
    }
    // *.jsp
    else if(fsentry.name.toLowerCase().endsWith('.jsp')){
        return {image: window.icons['file-jsp.svg'], type: 'icon'};
    }
    // *.log
    else if(fsentry.name.toLowerCase().endsWith('.log')){
        return {image: window.icons['file-log.svg'], type: 'icon'};
    }
    // *.mp3
    else if(fsentry.name.toLowerCase().endsWith('.mp3')){
        return {image: window.icons['file-mp3.svg'], type: 'icon'};
    }
    // *.rb
    else if(fsentry.name.toLowerCase().endsWith('.rb')){
        return {image: window.icons['file-ruby.svg'], type: 'icon'};
    }
    // *.rss
    else if(fsentry.name.toLowerCase().endsWith('.rss')){
        return {image: window.icons['file-rss.svg'], type: 'icon'};
    }
    // *.rtf
    else if(fsentry.name.toLowerCase().endsWith('.rtf')){
        return {image: window.icons['file-rtf.svg'], type: 'icon'};
    }
    // *.sketch
    else if(fsentry.name.toLowerCase().endsWith('.sketch')){
        return {image: window.icons['file-sketch.svg'], type: 'icon'};
    }
    // *.sql
    else if(fsentry.name.toLowerCase().endsWith('.sql')){
        return {image: window.icons['file-sql.svg'], type: 'icon'};
    }
    // *.tif
    else if(fsentry.name.toLowerCase().endsWith('.tif')){
        return {image: window.icons['file-tif.svg'], type: 'icon'};
    }
    // *.tiff
    else if(fsentry.name.toLowerCase().endsWith('.tiff')){
        return {image: window.icons['file-tiff.svg'], type: 'icon'};
    }
    // *.wav
    else if(fsentry.name.toLowerCase().endsWith('.wav')){
        return {image: window.icons['file-wav.svg'], type: 'icon'};
    }
    // *.cpp
    else if(fsentry.name.toLowerCase().endsWith('.cpp')){
        return {image: window.icons['file-cpp.svg'], type: 'icon'};
    }
    // *.pptx
    else if(fsentry.name.toLowerCase().endsWith('.pptx')){
        return {image: window.icons['file-pptx.svg'], type: 'icon'};
    }
    // *.psd
    else if(fsentry.name.toLowerCase().endsWith('.psd')){
        return {image: window.icons['file-psd.svg'], type: 'icon'};
    }
    // *.py
    else if(fsentry.name.toLowerCase().endsWith('.py')){
        return {image: window.icons['file-py.svg'], type: 'icon'};
    }
    // *.xlsx
    else if(fsentry.name.toLowerCase().endsWith('.xlsx')){
        return {image: window.icons['file-xlsx.svg'], type: 'icon'};
    }
    // *.weblink
    else if(fsentry.name.toLowerCase().endsWith('.weblink')){
        let faviconUrl = null;

        // First try to get icon from data attribute
        if (fsentry.icon) {
            faviconUrl = fsentry.icon;
        }
        // Then try metadata
        else if (fsentry.metadata) {
            try {
                const metadata = JSON.parse(fsentry.metadata);
                if (metadata && metadata.faviconUrl) {
                    faviconUrl = metadata.faviconUrl;
                } else if (metadata && metadata.url) {
                    // If we have the URL but no favicon, generate the Google favicon URL
                    const urlObj = new URL(metadata.url);
                    faviconUrl = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
                }
            } catch (e) {
                console.error("Error parsing weblink metadata:", e);
            }
        }
        // Finally try content
        else if (fsentry.content) {
            try {
                const content = JSON.parse(fsentry.content);
                if (content && content.faviconUrl) {
                    faviconUrl = content.faviconUrl;
                } else if (content && content.url) {
                    // If we have the URL but no favicon, generate the Google favicon URL
                    const urlObj = new URL(content.url);
                    faviconUrl = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
                }
            } catch (e) {
                console.error("Error parsing weblink content:", e);
            }
        }

        // If we found a favicon URL, use it
        if (faviconUrl) {
            return {
                image: faviconUrl,
                type: 'icon',
                onerror: function() {
                    // If favicon fails to load, switch to default icon
                    const $icons = $(`img[data-icon="${faviconUrl}"]`);
                    $icons.attr('src', window.icons['link.svg']);
                    return window.icons['link.svg'];
                }
            };
        }

        // Fallback to default link icon
        return {image: window.icons['link.svg'], type: 'icon'};
    }
    // --------------------------------------------------
    // Determine icon by set or derived mime type
    // --------------------------------------------------
    else if(fsentry.type){
        return {image: content_type_to_icon(fsentry.type), type: 'icon'};
    }
    else{
        return {image: content_type_to_icon(mime.getType(fsentry.name)), type: 'icon'};
    }
}

export default item_icon;