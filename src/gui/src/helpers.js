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

import path from "./lib/path.js"
import mime from "./lib/mime.js";
import UIAlert from './UI/UIAlert.js'
import UIItem from './UI/UIItem.js'
import UIWindowLogin from './UI/UIWindowLogin.js';
import UIWindowSaveAccount from './UI/UIWindowSaveAccount.js';
import update_username_in_gui from './helpers/update_username_in_gui.js';
import update_title_based_on_uploads from './helpers/update_title_based_on_uploads.js';
import truncate_filename from './helpers/truncate_filename.js';
import UIWindowProgress from './UI/UIWindowProgress.js';
import globToRegExp from "./helpers/globToRegExp.js";
import get_html_element_from_options from "./helpers/get_html_element_from_options.js";
import item_icon from "./helpers/item_icon.js";
import play_startup_chime from "./helpers/play_startup_chime.js";

window.is_auth = ()=>{
    if(localStorage.getItem("auth_token") === null || window.auth_token === null)
        return false;
    else
        return true;
}

window.suggest_apps_for_fsentry = async (options)=>{
    let res = await $.ajax({
        url: window.api_origin + "/suggest_apps",
        type: 'POST',
        contentType: "application/json",
        data: JSON.stringify({
            uid: options.uid ?? undefined,
            path: options.path ?? undefined,
        }),
        headers: {
            "Authorization": "Bearer "+window.auth_token
        },
        statusCode: {
            401: function () {
                window.logout();
            },
        },     
        success: function (res){
            if(options.onSuccess && typeof options.onSuccess == "function")
                options.onSuccess(res);
        }
    });

    return res;
}

/**
 * Formats a binary-byte integer into the human-readable form with units.
 * 
 * @param {integer} bytes 
 * @returns 
 */
window.byte_format = (bytes)=>{
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
	if (bytes === 0) return '0 Byte';
	const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
	return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
};

/**
 * A function that generates a UUID (Universally Unique Identifier) using the version 4 format, 
 * which are random UUIDs. It uses the cryptographic number generator available in modern browsers.
 *
 * The generated UUID is a 36 character string (32 alphanumeric characters separated by 4 hyphens). 
 * It follows the pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx, where x is any hexadecimal digit 
 * and y is one of 8, 9, A, or B.
 *
 * @returns {string} Returns a new UUID v4 string.
 *
 * @example
 * 
 * let id = window.uuidv4(); // Generate a new UUID
 * 
 */
window.uuidv4 = ()=>{
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

/**
 * Checks if the provided string is a valid email format.
 *
 * @function
 * @global
 * @param {string} email - The email string to be validated.
 * @returns {boolean} `true` if the email is valid, otherwise `false`.
 * @example
 * window.is_email("test@example.com");     // true
 * window.is_email("invalid-email");        // false
 */
window.is_email = (email) => {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
}

/**
 * A function that scrolls the parent element so that the child element is in view. 
 * If the child element is already in view, no scrolling occurs. 
 * The function decides the best scroll direction based on which requires the smaller adjustment.
 *
 * @param {HTMLElement} parent - The parent HTML element that might be scrolled.
 * @param {HTMLElement} child - The child HTML element that should be made viewable.
 * 
 * @returns {void}
 *
 * @example
 *
 * let parentElem = document.querySelector('#parent');
 * let childElem = document.querySelector('#child');
 * window.scrollParentToChild(parentElem, childElem); 
 * // Scrolls parentElem so that childElem is in view
 *
 */
window.scrollParentToChild = (parent, child)=>{
    // Where is the parent on page
    var parentRect = parent.getBoundingClientRect();

    // What can you see?
    var parentViewableArea = {
      height: parent.clientHeight,
      width: parent.clientWidth
    };
  
    // Where is the child
    var childRect = child.getBoundingClientRect();
    // Is the child viewable?
    var isViewable = (childRect.top >= parentRect.top) && (childRect.bottom <= parentRect.top + parentViewableArea.height);
  
    // if you can't see the child try to scroll parent
    if (!isViewable) {
          // Should we scroll using top or bottom? Find the smaller ABS adjustment
          const scrollTop = childRect.top - parentRect.top;
          const scrollBot = childRect.bottom - parentRect.bottom;
          if (Math.abs(scrollTop) < Math.abs(scrollBot)) {
              // we're near the top of the list
              parent.scrollTop += (scrollTop + 80);
          } else {
              // we're near the bottom of the list
              parent.scrollTop += (scrollBot + 80);
          }
    }
}

/**
 * Validates the provided file system entry name.
 *
 * @function validate_fsentry_name
 * @memberof window
 * @param {string} name - The name of the file system entry to validate.
 * @returns {boolean} Returns true if the name is valid.
 * @throws {Object} Throws an object with a `message` property indicating the specific validation error.
 * 
 * @description
 * This function checks the provided name against a set of rules to determine its validity as a file system entry name:
 * 1. Name cannot be empty.
 * 2. Name must be a string.
 * 3. Name cannot contain the '/' character.
 * 4. Name cannot be the '.' character.
 * 5. Name cannot be the '..' character.
 * 6. Name cannot exceed the maximum allowed length (as defined in window.max_item_name_length).
 */
window.validate_fsentry_name = function(name){
    if(!name)
        throw {message: i18n('name_cannot_be_empty')}
    else if(!window.isString(name))
        throw {message: i18n('name_must_be_string')}
    else if(name.includes('/'))
        throw {message: i18n('name_cannot_contain_slash')}
    else if(name === '.')
        throw {message: i18n('name_cannot_contain_period')};
    else if(name === '..')
        throw {message: i18n('name_cannot_contain_double_period')};
    else if(name.length > window.max_item_name_length)
        throw {message: i18n('name_too_long', window.max_item_name_length)}
    else
        return true
}

/**
 * A function that generates a unique identifier by combining a random adjective, a random noun, and a random number (between 0 and 9999).
 * The result is returned as a string with components separated by hyphens.
 * It is useful when you need to create unique identifiers that are also human-friendly.
 *
 * @returns {string} A unique, hyphen-separated string comprising of an adjective, a noun, and a number.
 *
 * @example
 *
 * let identifier = window.generate_identifier(); 
 * // identifier would be something like 'clever-idea-123'
 *
 */
window.generate_identifier = function(){
    const first_adj = ['helpful','sensible', 'loyal', 'honest', 'clever', 'capable','calm', 'smart', 'genius', 'bright', 'charming', 'creative', 'diligent', 'elegant', 'fancy', 
    'colorful', 'avid', 'active', 'gentle', 'happy', 'intelligent', 'jolly', 'kind', 'lively', 'merry', 'nice', 'optimistic', 'polite', 
    'quiet', 'relaxed', 'silly', 'victorious', 'witty', 'young', 'zealous', 'strong', 'brave', 'agile', 'bold'];

    const nouns = ['street', 'roof', 'floor', 'tv', 'idea', 'morning', 'game', 'wheel', 'shoe', 'bag', 'clock', 'pencil', 'pen', 
    'magnet', 'chair', 'table', 'house', 'dog', 'room', 'book', 'car', 'cat', 'tree', 
    'flower', 'bird', 'fish', 'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'wind', 'mountain', 
    'river', 'lake', 'sea', 'ocean', 'island', 'bridge', 'road', 'train', 'plane', 'ship', 'bicycle', 
    'horse', 'elephant', 'lion', 'tiger', 'bear', 'zebra', 'giraffe', 'monkey', 'snake', 'rabbit', 'duck', 
    'goose', 'penguin', 'frog', 'crab', 'shrimp', 'whale', 'octopus', 'spider', 'ant', 'bee', 'butterfly', 'dragonfly', 
    'ladybug', 'snail', 'camel', 'kangaroo', 'koala', 'panda', 'piglet', 'sheep', 'wolf', 'fox', 'deer', 'mouse', 'seal',
    'chicken', 'cow', 'dinosaur', 'puppy', 'kitten', 'circle', 'square', 'garden', 'otter', 'bunny', 'meerkat', 'harp']

    // return a random combination of first_adj + noun + number (between 0 and 9999)
    // e.g. clever-idea-123
    return first_adj[Math.floor(Math.random() * first_adj.length)] + '-' + nouns[Math.floor(Math.random() * nouns.length)] + '-' + Math.floor(Math.random() * 10000);
}

/**
 * Checks if the provided variable is a string or an instance of the String object.
 *
 * @param {*} variable - The variable to check.
 * @returns {boolean} True if the variable is a string or an instance of the String object, false otherwise.
 */
window.isString =  function (variable) {
    return typeof variable === 'string' || variable instanceof String;
}

/**
 * A function that checks whether a file system entry (fsentry) matches a list of allowed file types.
 * It handles both file extensions (like '.jpg') and MIME types (like 'text/plain').
 * If the allowed file types string is empty or not provided, the function always returns true.
 * It checks the file types only if the fsentry is a file, not a directory.
 *
 * @param {Object} fsentry - The file system entry to check. It must be an object with properties: 'is_dir', 'name', 'type'.
 * @param {string} allowed_file_types_string - The list of allowed file types, separated by commas. Can include extensions and MIME types.
 * 
 * @returns {boolean} True if the fsentry matches one of the allowed file types, or if the allowed_file_types_string is empty or not provided. False otherwise.
 *
 * @example
 *
 * let fsentry = {is_dir: false, name: 'example.jpg', type: 'image/jpeg'};
 * let allowedTypes = '.jpg, text/plain, image/*';
 * let result = window.check_fsentry_against_allowed_file_types_string(fsentry, allowedTypes); 
 * // result would be true, as 'example.jpg' matches the '.jpg' in allowedTypes
 *
 */

window.check_fsentry_against_allowed_file_types_string =function (fsentry, allowed_file_types_string) {
    // simple cases that are always a pass
    if(!allowed_file_types_string || allowed_file_types_string.trim() === '')
        return  true;

    // parse allowed_file_types into an array of extensions and types
    let allowed_file_types = allowed_file_types_string.split(',');
    if(allowed_file_types.length > 0){
        // trim every entry
        for (let index = 0; index < allowed_file_types.length; index++) {
            allowed_file_types[index] = allowed_file_types[index].trim();
        }
    }    

    let passes_allowed_file_type_filter = true;
    // check types, only if this fsentry is a file and not a directory
    if(!fsentry.is_dir && allowed_file_types.length > 0){
        passes_allowed_file_type_filter = false;
        for (let index = 0; index < allowed_file_types.length; index++) {
            const allowed_file_type = allowed_file_types[index].toLowerCase();

            // if type is not already set, try to set it based on the file name
            if(!fsentry.type)
                fsentry.type = mime.getType(fsentry.name);

            // extensions (e.g. .jpg)
            if(allowed_file_type.startsWith('.') && fsentry.name.toLowerCase().endsWith(allowed_file_type)){
                passes_allowed_file_type_filter = true;
                break;
            }

            // MIME types (e.g. text/plain)
            else if(globToRegExp(allowed_file_type).test(fsentry.type?.toLowerCase())){
                passes_allowed_file_type_filter = true;
                break;
            }
        }
    }

    return passes_allowed_file_type_filter;
}

// @author Rich Adams <rich@richadams.me>

// Implements a tap and hold functionality. If you click/tap and release, it will trigger a normal
// click event. But if you click/tap and hold for 1s (default), it will trigger a taphold event instead.

;(function($)
{
    // Default options
    var defaults = {
        duration: 500, // ms
        clickHandler: null
    }

    // When start of a taphold event is triggered.
    function startHandler(event)
    {
        var $elem = jQuery(this);

        // Merge the defaults and any user defined settings.
        let settings = jQuery.extend({}, defaults, event.data);

        // If object also has click handler, store it and unbind. Taphold will trigger the
        // click itself, rather than normal propagation.
        if (typeof $elem.data("events") != "undefined"
            && typeof $elem.data("events").click != "undefined")
        {
            // Find the one without a namespace defined.
            for (var c in $elem.data("events").click)
            {
                if ($elem.data("events").click[c].namespace == "")
                {
                    var handler = $elem.data("events").click[c].handler
                    $elem.data("taphold_click_handler", handler);
                    $elem.unbind("click", handler);
                    break;
                }
            }
        }
        // Otherwise, if a custom click handler was explicitly defined, then store it instead.
        else if (typeof settings.clickHandler == "function")
        {
            $elem.data("taphold_click_handler", settings.clickHandler);
        }

        // Reset the flags
        $elem.data("taphold_triggered", false); // If a hold was triggered
        $elem.data("taphold_clicked",   false); // If a click was triggered
        $elem.data("taphold_cancelled", false); // If event has been cancelled.

        // Set the timer for the hold event.
        $elem.data("taphold_timer",
            setTimeout(function()
            {
                // If event hasn't been cancelled/clicked already, then go ahead and trigger the hold.
                if (!$elem.data("taphold_cancelled")
                    && !$elem.data("taphold_clicked"))
                {
                    // Trigger the hold event, and set the flag to say it's been triggered.
                    $elem.trigger(jQuery.extend(event, jQuery.Event("taphold")));
                    $elem.data("taphold_triggered", true);
                }
            }, settings.duration));
    }

    // When user ends a tap or click, decide what we should do.
    function stopHandler(event)
    {
        var $elem = jQuery(this);

        // If taphold has been cancelled, then we're done.
        if ($elem.data("taphold_cancelled")) { return; }

        // Clear the hold timer. If it hasn't already triggered, then it's too late anyway.
        clearTimeout($elem.data("taphold_timer"));

        // If hold wasn't triggered and not already clicked, then was a click event.
        if (!$elem.data("taphold_triggered")
            && !$elem.data("taphold_clicked"))
        {
            // If click handler, trigger it.
            if (typeof $elem.data("taphold_click_handler") == "function")
            {
                $elem.data("taphold_click_handler")(jQuery.extend(event, jQuery.Event("click")));
            }

            // Set flag to say we've triggered the click event.
            $elem.data("taphold_clicked", true);
        }
    }

    // If a user prematurely leaves the boundary of the object we're working on.
    function leaveHandler(event)
    {
        // Cancel the event.
        $(this).data("taphold_cancelled", true);
    }

    // Determine if touch events are supported.
    var touchSupported = ("ontouchstart" in window) // Most browsers
                         || ("onmsgesturechange" in window); // Microsoft

    var taphold = $.event.special.taphold =
    {
        setup: function(data)
        {
            $(this).bind((touchSupported ? "touchstart"            : "mousedown"),  data, startHandler)
                   .bind((touchSupported ? "touchend"              : "mouseup"),    stopHandler)
                   .bind((touchSupported ? "touchmove touchcancel" : "mouseleave"), leaveHandler);
        },
        teardown: function(namespaces)
        {
            $(this).unbind((touchSupported ? "touchstart"            : "mousedown"),  startHandler)
                   .unbind((touchSupported ? "touchend"              : "mouseup"),    stopHandler)
                   .unbind((touchSupported ? "touchmove touchcancel" : "mouseleave"), leaveHandler);
        }
    };
})(jQuery);

window.refresh_user_data = async (auth_token)=>{
    let whoami
    try{
        whoami = await puter.os.user({query: 'icon_size=64'});
    }catch(e){
        // Ignored
    }
    // update local user data
    if(whoami){
        window.update_auth_data(auth_token, whoami)
    }
}

window.update_auth_data = async (auth_token, user)=>{
    window.auth_token = auth_token;
    localStorage.setItem('auth_token', auth_token);

    // Play startup chime if enabled
    if ( sessionStorage.getItem('playChimeNextUpdate') === 'yes' ) {
        sessionStorage.setItem('playChimeNextUpdate', 'no');
        // play_startup_chime();
    }

    // Has username changed?
    if(window.user?.username !== user.username)
        update_username_in_gui(user.username);

    // Has email changed?
    if(window.user?.email !== user.email && user.email){
        $('.user-email').html(html_encode(user.email));
    }

    // ----------------------------------------------------
    // get .profile file and update user profile
    // ----------------------------------------------------
    user.profile = {};
    puter.fs.read('/'+user.username+'/Public/.profile').then((blob)=>{
        blob.text()
        .then(text => {
            const profile = JSON.parse(text);
            if(profile.picture){
                window.user.profile.picture = html_encode(profile.picture);
            }

            // update profile picture in GUI
            if(window.user.profile.picture){
                $('.profile-pic').css('background-image', 'url('+window.user.profile.picture+')');
            }
        })
        .catch(error => {
            console.error('Error converting Blob to JSON:', error);
        });
    }).catch((e)=>{
        if(e?.code === "subject_does_not_exist"){
            // create .profile file
            puter.fs.write('/'+user.username+'/Public/.profile', JSON.stringify({}));
        }
    });

    // ----------------------------------------------------

    const to_storable_user = user => {
        const storable_user = {...user};
        delete storable_user.taskbar_items;
        return storable_user;
    };

    // update this session's user data
    window.user = user;
    localStorage.setItem('user', JSON.stringify(to_storable_user(user)));

    // re-initialize the Puter.js objects with the new auth token
    puter.setAuthToken(auth_token, window.api_origin)

    //update the logged_in_users array entry for this user
    if(window.user){
        let logged_in_users_updated = false;
        for (let i = 0; i < window.logged_in_users.length && !logged_in_users_updated; i++) {
            if(window.logged_in_users[i].uuid === window.user.uuid){
                window.logged_in_users[i] = window.user;
                window.logged_in_users[i].auth_token = window.auth_token;
                logged_in_users_updated = true;
            }
        }

        // no matching array elements, add one
        if(!logged_in_users_updated){
            let userobj = window.user;
            userobj.auth_token = window.auth_token;
            window.logged_in_users.push(userobj);
        }
        // update local storage
        localStorage.setItem('logged_in_users', JSON.stringify(
            window.logged_in_users.map(to_storable_user)));
    }

    window.desktop_path = '/' + window.user.username + '/Desktop';
    window.trash_path = '/' + window.user.username + '/Trash';
    window.appdata_path = '/' + window.user.username + '/AppData';
    window.docs_path = '/' + window.user.username + '/Documents';
    window.pictures_path = '/' + window.user.username + '/Pictures';
    window.videos_path = '/' + window.user.username + '/Videos';
    window.desktop_path = '/' + window.user.username + '/Desktop';
    window.home_path = '/' + window.user.username;
    window.public_path =  '/' + window.user.username + '/Public';

    if(window.user !== null && !window.user.is_temp){
        $('.user-options-login-btn, .user-options-create-account-btn').hide();
        $('.user-options-menu-btn').show();
    }

    // Search and store user templates
    window.file_templates = await window.available_templates()
}

window.mutate_user_preferences = function(user_preferences_delta) {
    for (const [key, value] of Object.entries(user_preferences_delta)) {
        // Don't wait for set to be done for better efficiency
        puter.kv.set(`user_preferences.${key}`, value);
    }
    // There may be syncing issues across multiple devices
    window.update_user_preferences({ ...window.user_preferences, ...user_preferences_delta });
}

window.update_user_preferences = function(user_preferences) {
    window.user_preferences = user_preferences;
    localStorage.setItem('user_preferences', JSON.stringify(user_preferences));
    const language = user_preferences.language ?? 'en';
    window.locale = language;

    // Broadcast locale change to apps
    const broadcastService = globalThis.services.get('broadcast');
    broadcastService.sendBroadcast('localeChanged', {
        language: language,
    }, { sendToNewAppInstances: true });
}

window.sendWindowWillCloseMsg = function(iframe_element) {
    return new Promise(function(resolve){
        const msg_id = window.uuidv4();
        iframe_element.contentWindow.postMessage({
            msg: "windowWillClose",
            msg_id: msg_id
        }, '*');
        //register callback
        window.appCallbackFunctions[msg_id] = resolve;
    })
}

window.logout = ()=>{
    $(document).trigger('logout');
    // document.dispatchEvent(new Event("logout", { bubbles: true}));    
}

/**
 * Checks if the current document is in fullscreen mode.
 *
 * @function is_fullscreen
 * @memberof window
 * @returns {boolean} Returns true if the document is in fullscreen mode, otherwise false.
 *
 * @example
 * // Checks if the document is currently in fullscreen mode
 * const inFullscreen = window.is_fullscreen();
 * 
 * @description
 * This function checks various browser-specific properties to determine if the document 
 * is currently being displayed in fullscreen mode. It covers standard as well as 
 * some vendor-prefixed properties to ensure compatibility across different browsers.
 */
window.is_fullscreen = ()=>{
    return (document.fullscreenElement && document.fullscreenElement !== null) ||
    (document.webkitIsFullScreen && document.webkitIsFullScreen !== null) ||
    (document.webkitFullscreenElement && document.webkitFullscreenElement !== null) ||
    (document.mozFullScreenElement && document.mozFullScreenElement !== null) ||
    (document.msFullscreenElement && document.msFullscreenElement !== null);
}

window.get_apps = async (app_names, callback)=>{
    if(Array.isArray(app_names))
        app_names = app_names.join('|');

    // 'explorer' is a special app, no metadata should be returned
    if(app_names === 'explorer')
        return [];

    let res = await $.ajax({
        url: window.api_origin + "/apps/"+app_names,
        type: 'GET',
        async: true,
        contentType: "application/json",
        headers: {
            "Authorization": "Bearer "+window.auth_token
        },
        success: function (res){ 
        }
    });

    if(res.length === 1)
        res = res[0];

    if(callback && typeof callback === 'function')
        callback(res);
    else
        return res;
}

/**
 * Sends an "itemChanged" event to all watching applications associated with a specific item.
 *
 * @function sendItemChangeEventToWatchingApps
 * @memberof window
 * @param {string} item_uid - Unique identifier of the item that experienced the change.
 * @param {Object} event_data - Additional data about the event to be passed to the watching applications.
 * 
 * @description
 * This function sends an "itemChanged" message to all applications that are currently watching 
 * the specified item. If an application's iframe is not found or no longer valid, 
 * it is removed from the list of watchers.
 * 
 * The function expects that `window.watchItems` contains a mapping of item UIDs to arrays of app instance IDs.
 * 
 * @example
 * // Example usage to send a change event to watching applications of an item with UID "item123".
 * window.sendItemChangeEventToWatchingApps('item123', { property: 'value' });
 */
window.sendItemChangeEventToWatchingApps = function(item_uid, event_data){
    if(window.watchItems[item_uid]){
        window.watchItems[item_uid].forEach(app_instance_id => {
            const iframe = $(`.window[data-element_uuid="${app_instance_id}"]`).find('.window-app-iframe')
            if(iframe && iframe.length > 0){
                iframe.get(0)?.contentWindow
                    .postMessage({
                        msg: 'itemChanged',
                        data: event_data,
                    }, '*');
            }else{
                window.watchItems[item_uid].splice(window.watchItems[item_uid].indexOf(app_instance_id), 1);
            }
        });
    }
}

/**
 * Asynchronously checks if a save account notice should be shown to the user, and if needed, displays the notice.
 *
 * This function first retrieves a key value pair from the cloud key-value storage to determine if the notice has been shown before.
 * If the notice hasn't been shown and the user is using a temporary session, the notice is then displayed. After the notice is shown,
 * the function updates the key-value storage indicating that the notice has been shown. The user can choose to save the session,
 * remind later or log in to an existing account.
 *
 * @param {string} [message] - The custom message to be displayed in the notice. If not provided, a default message will be used.
 * @global
 * @function window.show_save_account_notice_if_needed
 */

window.show_save_account_notice_if_needed = function(message){
    puter.kv.get({
        key: "save_account_notice_shown",
    }).then(async function(value){
        if(!value && window.user?.is_temp){
            puter.kv.set({
                key: "save_account_notice_shown",
                value: true,
            });
            // Show the notice
            setTimeout(async () => {
                const alert_resp = await UIAlert({
                    message: message ?? `<strong>Congrats on storing data!</strong><p>Don't forget to save your session! You are in a temporary session. Save session to avoid accidentally losing your work.</p>`,
                    body_icon: window.icons['reminder.svg'],
                    buttons:[
                        {
                            label: i18n('save_session'),
                            value: 'save-session',
                            type: 'primary',
                        },
                        // {
                        //     label: 'Log into an existing account',
                        //     value: 'login',
                        // },
                        {
                            label: `I'll do it later`,
                            value: 'remind-later',
                        },
                    ],
                    window_options: {
                        backdrop: true,
                        close_on_backdrop_click: false,
                    }
    
                })   
                
                if(alert_resp === 'remind-later'){
                    // TODO
                }
                if(alert_resp === 'save-session'){
                    let saved = await UIWindowSaveAccount({
                        send_confirmation_code: false,
                    });

                }else if (alert_resp === 'login'){
                    let login_result = await UIWindowLogin({
                        show_signup_button: false, 
                        reload_on_success: true,
                        send_confirmation_code: false,
                        window_options: {
                            show_in_taskbar: false,
                            backdrop: true,
                            close_on_backdrop_click: false,
                        }
                    });
                    // FIXME: Report login error.
                }
            }, window.desktop_loading_fade_delay + 1000);
        }
    });
}

window.onpopstate = (event) => {
    if(event.state !== null && event.state.window_id !== null){
        $(`.window[data-id="${event.state.window_id}"]`).focusWindow();
    }
}

window.sort_items = (item_container, sort_by, sort_order)=>{
    if(sort_order !== 'asc' && sort_order !== 'desc')
        sort_order = 'asc';

    $(item_container).find(`.item[data-sortable="true"]`).detach().sort(function(a,b) {
        // Name
        if(!sort_by || sort_by === 'name'){
            if(a.dataset.name.toLowerCase() < b.dataset.name.toLowerCase()) { return (sort_order === 'asc' ? -1 : 1); }
            if(a.dataset.name.toLowerCase() > b.dataset.name.toLowerCase()) { return (sort_order === 'asc' ? 1 : -1); }
            return 0;
        }
        // Size
        else if(sort_by === 'size'){
            if( parseInt(a.dataset.size) < parseInt(b.dataset.size)) { return (sort_order === 'asc' ? -1 : 1); }
            if( parseInt(a.dataset.size) > parseInt(b.dataset.size)) { return (sort_order === 'asc' ? 1 : -1); }
            return 0;
        }
        // Modified
        else if(sort_by === 'modified'){
            if( parseInt(a.dataset.modified) < parseInt(b.dataset.modified)) { return (sort_order === 'asc' ? -1 : 1); }
            if( parseInt(a.dataset.modified) > parseInt(b.dataset.modified)) { return (sort_order === 'asc' ? 1 : -1); }
            return 0;
        }
        // Type
        else if(sort_by === 'type'){
            if(path.extname(a.dataset.name.toLowerCase()) < path.extname(b.dataset.name.toLowerCase())) { return (sort_order === 'asc' ? -1 : 1); }
            if(path.extname(a.dataset.name.toLowerCase()) > path.extname(b.dataset.name.toLowerCase())) { return (sort_order === 'asc' ? 1 : -1); }
            return 0;
        }

    }).appendTo(item_container);
}

window.show_or_hide_files = (item_containers) => {
    const show_hidden_files = window.user_preferences.show_hidden_files;
    const class_to_add = show_hidden_files ? 'item-revealed' : 'item-hidden';
    const class_to_remove = show_hidden_files ? 'item-hidden' : 'item-revealed';
    $(item_containers)
        .find('.item')
        .filter((_, item) => item.dataset.name.startsWith('.'))
        .removeClass(class_to_remove).addClass(class_to_add);
}

window.create_folder = async(basedir, appendto_element)=>{
	let dirname = basedir;
    let folder_name = 'New Folder';

    let newfolder_op_id = window.operation_id++;
    window.operation_cancelled[newfolder_op_id] = false;
    let newfolder_progress_window_init_ts = Date.now();
    let progwin;

    // only show progress window if it takes longer than 500ms to create folder
    let progwin_timeout = setTimeout(async () => {
        progwin = await UIWindowProgress({
            operation_id: newfolder_op_id,
            // TODO: Implement cancellation.
            // on_cancel: () => {
            //     window.operation_cancelled[newfolder_op_id] = true;
            // },
        });
        progwin.set_status(i18n('taking_longer_than_usual'));
    }, 500);

    // create folder
    try{
        await puter.fs.mkdir({
            path: dirname + '/'+folder_name,
            rename: true,
            overwrite: false,
            success: function (data){
                const el_created_dir = $(appendto_element).find('.item[data-path="'+html_encode(dirname)+'/'+html_encode(data.name)+'"]');
                if(el_created_dir.length > 0){
                    window.activate_item_name_editor(el_created_dir);

                    // Add action to actions_history for undo ability
                    window.actions_history.push({
                        operation: 'create_folder',
                        data: el_created_dir
                        
                    });
                }
                clearTimeout(progwin_timeout);

                // done
                let newfolder_duration = (Date.now() - newfolder_progress_window_init_ts);
                if (progwin) {
                    if (newfolder_duration >= window.copy_progress_hide_delay) {
                        progwin.close();
                    } else {
                        setTimeout(() => {
                            setTimeout(() => {
                                progwin.close();
                            }, Math.abs(window.copy_progress_hide_delay - newfolder_duration));
                        });
                    }
                }
            }
        });
    }catch(err){
        clearTimeout(progwin_timeout);
    }
}

window.create_file = async(options)=>{
    // args
    let dirname = options.dirname;
    let appendto_element = options.append_to_element;
    let filename = options.name;
    let content = options.content ? [options.content] : [];

    // create file
    try{
        puter.fs.upload(new File(content, filename),  dirname,
        {
            success: async function (data){
                const created_file = $(appendto_element).find('.item[data-path="'+html_encode(dirname)+'/'+html_encode(data.name)+'"]');
                if(created_file.length > 0){
                    window.activate_item_name_editor(created_file);

                    // Add action to actions_history for undo ability
                    window.actions_history.push({
                        operation: 'create_file',
                        data: created_file
                    });
                }
            }
        });
    }catch(err){
        console.log(err);
    }
}

window.available_templates = async () => {
    const baseRoute = `/${window.user.username}`
    const keywords = ["template", "templates", i18n('template')]
    //make sure all its lowercase
    const lowerCaseKeywords = keywords.map(keywords => keywords.toLowerCase())

    //create file
    try{
        // search the folder name i18n("template"), "template" or "templates"
        const files = await puter.fs.readdir(baseRoute)

        const hasTemplateFolder = files.find(file => lowerCaseKeywords.includes(file.name.toLowerCase()))

        if(!hasTemplateFolder){
            return []
        }

        const hasTemplateFiles = await puter.fs.readdir(baseRoute + "/" + hasTemplateFolder.name)

        if(hasTemplateFiles.length == 0) {
            return []
        }

        let result = []

        hasTemplateFiles.forEach(element => {
            const extIndex = element.name.lastIndexOf('.');
            const name = extIndex === -1
                ? element.name
                : element.name.slice(0, extIndex);
            let extension = extIndex === -1
                ? ''
                : element.name.slice(extIndex + 1);

            if(extension == "txt") extension = "text"
            
            const _path = path.join( baseRoute, hasTemplateFolder.name, element.name);

            const itemStructure = {
                path: _path,
                html: `${extension.toUpperCase()} ${name}`,
                extension:extension,
                name: element.name
            }
            result.push(itemStructure)
        });
        
        // return result
        return result
        
    } catch (err) {
        console.log(err)
    }
}

window.create_shortcut = async(filename, is_dir, basedir, appendto_element, shortcut_to, shortcut_to_path)=>{
    const extname = path.extname(filename);
    const basename = path.basename(filename, extname) + ' - Shortcut';
    filename = basename + extname;

    // create file shortcut
    try{
        await puter.fs.upload(new File([], filename), basedir, {
            overwrite: false,
            shortcutTo: shortcut_to_path ?? shortcut_to,
            dedupeName: true,
        });
    }catch(err){
        console.log(err)
    }
}

window.copy_clipboard_items = async function(dest_path, dest_container_element){
    let copy_op_id = window.operation_id++;
    window.operation_cancelled[copy_op_id] = false;
    // unselect previously selected items in the target container
    $(dest_container_element).children('.item-selected').removeClass('item-selected');
    window.update_explorer_footer_selected_items_count($(dest_container_element).closest('.window'));

    let overwrite_all = false;
    (async()=>{
        let copy_progress_window_init_ts = Date.now();

        // only show progress window if it takes longer than 2s to copy
        let progwin;
        let progwin_timeout = setTimeout(async () => {
            progwin = await UIWindowProgress({
                operation_id: copy_op_id,
                on_cancel: () => {
                    window.operation_cancelled[copy_op_id] = true;
                },
            });
        }, 0);

        const copied_item_paths = []

        for(let i=0; i<window.clipboard.length; i++){
            let copy_path = window.clipboard[i].path;
            let item_with_same_name_already_exists = true;
            let overwrite = overwrite_all;
            progwin?.set_status(i18n('copying_file', copy_path));

            do{
                if(overwrite)
                    item_with_same_name_already_exists = false;

                // cancelled?
                if(window.operation_cancelled[copy_op_id])
                    return;

                // perform copy
                try{
                    let resp = await puter.fs.copy({
                            source: copy_path,
                            destination: dest_path,
                            overwrite: overwrite || overwrite_all,
                            // if user is copying an item to where its source is, change the name so there is no conflict
                            dedupeName: dest_path === path.dirname(copy_path),
                    });

                    // remove overwritten item from the DOM
                    if(resp[0].overwritten?.id){
                        $(`.item[data-uid=${resp[0].overwritten.id}]`).removeItems();
                    }

                    // copy new path for undo copy
                    copied_item_paths.push(resp[0].copied.path);

                    // skips next loop iteration
                    break;
                }catch(err){
                    if(err.code==='item_with_same_name_exists'){
                        const alert_resp = await UIAlert({
                            message: `<strong>${html_encode(err.entry_name)}</strong> already exists.`,
                            buttons:[
                                {label: i18n('replace'), type: 'primary', value: 'replace'},
                                ... (window.clipboard.length > 1) ? [{label: i18n('replace_all'), value: 'replace_all'}] : [],
                                ... (window.clipboard.length > 1) ? [{label: i18n('skip'), value: 'skip'}] : [{label: i18n('cancel'), value: 'cancel'}],
                            ]
                        })
                        if(alert_resp === 'replace'){
                            overwrite = true;
                        }else if (alert_resp === 'replace_all'){
                            overwrite = true;
                            overwrite_all = true;
                        }else if(alert_resp === 'skip' || alert_resp === 'cancel'){
                            item_with_same_name_already_exists = false;
                        }
                    }
                    else{
                        if(err.message){
                            UIAlert(err.message)
                        }
                        item_with_same_name_already_exists = false;
                    }
                }
            }while(item_with_same_name_already_exists)
        }

        // done
        // Add action to actions_history for undo ability
        window.actions_history.push({
            operation: 'copy',
            data: copied_item_paths
        });

        clearTimeout(progwin_timeout);

        let copy_duration = (Date.now() - copy_progress_window_init_ts);
        if (progwin) {
            if (copy_duration >= window.copy_progress_hide_delay) {
                progwin.close();
            } else {
                setTimeout(() => {
                    setTimeout(() => {
                        progwin.close();
                    }, Math.abs(window.copy_progress_hide_delay - copy_duration));
                });
            }
        }
    })();
}

/**
 * Copies the given items to the destination path.
 * 
 * @param {HTMLElement[]} el_items - HTML elements representing the items to copy
 * @param {string} dest_path - Destination path to copy items to
 */
window.copy_items = function(el_items, dest_path){
    let copy_op_id = window.operation_id++;
    let overwrite_all = false;
    (async()=>{
        let copy_progress_window_init_ts = Date.now();

        // only show progress window if it takes longer than 2s to copy
        let progwin;
        let progwin_timeout = setTimeout(async () => {
            progwin = await UIWindowProgress({
                operation_id: copy_op_id,
                on_cancel: () => {
                    window.operation_cancelled[copy_op_id] = true;
                },
            });
        }, 2000);

        const copied_item_paths = []

        for(let i=0; i < el_items.length; i++){
            let copy_path = $(el_items[i]).attr('data-path');
            let item_with_same_name_already_exists = true;
            let overwrite = overwrite_all;
            progwin?.set_status(i18n('copying_file', copy_path));

            do{
                if(overwrite)
                    item_with_same_name_already_exists = false;
                // cancelled?
                if(window.operation_cancelled[copy_op_id])
                    return;
                try{
                    let resp = await puter.fs.copy({
                            source: copy_path,
                            destination: dest_path,
                            overwrite: overwrite || overwrite_all,
                            // if user is copying an item to where the source is, automatically change the name so there is no conflict
                            dedupeName: dest_path === path.dirname(copy_path),
                    })

                    // remove overwritten item from the DOM
                    if(resp[0].overwritten?.id){
                        $(`.item[data-uid=${resp.overwritten.id}]`).removeItems();
                    }

                    // copy new path for undo copy
                    copied_item_paths.push(resp[0].copied.path);

                    // skips next loop iteration
                    item_with_same_name_already_exists = false;
                }catch(err){
                    if(err.code === 'item_with_same_name_exists'){
                        const alert_resp = await UIAlert({
                            message: `<strong>${html_encode(err.entry_name)}</strong> already exists.`,
                            buttons:[
                                { label: i18n('replace'), type: 'primary', value: 'replace' },
                                ... (el_items.length > 1) ? [{label: i18n('replace_all'), value: 'replace_all'}] : [],
                                ... (el_items.length > 1) ? [{label: i18n('skip'), value: 'skip'}] : [{label: i18n('cancel'), value: 'cancel'}],
                            ]
                        })
                        if(alert_resp === 'replace'){
                            overwrite = true;
                        }else if (alert_resp === 'replace_all'){
                            overwrite = true;
                            overwrite_all = true;
                        }else if(alert_resp === 'skip' || alert_resp === 'cancel'){
                            item_with_same_name_already_exists = false;
                        }
                    }
                    else{
                        if(err.message){
                            UIAlert(err.message)
                        }
                        else if(err){
                            UIAlert(err)
                        }
                        item_with_same_name_already_exists = false;
                    }
                }
            }while(item_with_same_name_already_exists)
        }

        // done
        // Add action to actions_history for undo ability
        window.actions_history.push({
            operation: 'copy',
            data: copied_item_paths
        });

        clearTimeout(progwin_timeout);

        let copy_duration = (Date.now() - copy_progress_window_init_ts);
        if (progwin) {
            if (copy_duration >= window.copy_progress_hide_delay) {
                progwin.close();
            } else {
                setTimeout(() => {
                    setTimeout(() => {
                        progwin.close();
                    }, Math.abs(window.copy_progress_hide_delay - copy_duration));
                });
            }
        }
    })()
}

/**
 * Deletes the given item.
 * 
 * @param {HTMLElement} el_item - HTML element representing the item to delete 
 * @param {boolean} [descendants_only=false] - If true, only deletes descendant items under the given item
 * @returns {Promise<void>}
 */
window.delete_item = async function(el_item, descendants_only = false){
    if($(el_item).attr('data-immutable') === '1')
        return;

    // hide all UIItems with matching uids 
    $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).fadeOut(150, function(){
        // close all windows with matching uids
        $('.window-' + $(el_item).attr('data-uid')).close();
        // close all windows that belong to a descendant of this item
        // todo this has to be case-insensitive but the `i` selector doesn't work on ^=
        $(`.window[data-path^="${$(el_item).attr('data-path')}/"]`).close();
    });

    try{
        await puter.fs.delete({
            paths: $(el_item).attr('data-path'),
            descendantsOnly: descendants_only,
            recursive: true,
        });
        // fade out item 
        $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).fadeOut(150, function(){
            // find all parent windows that contain this item
            let parent_windows = $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).closest('.window');
            // remove item from DOM
            $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).removeItems();
            // update parent windows' item counts
            $(parent_windows).each(function(index){
                window.update_explorer_footer_item_count(this);
                window.update_explorer_footer_selected_items_count(this);
            });
            // update all shortcuts to this item
            $(`.item[data-shortcut_to_path="${html_encode($(el_item).attr('data-path'))}" i]`).attr(`data-shortcut_to_path`, '');
        });
    }catch(err){
        UIAlert(err.responseText);
    }
}

window.move_clipboard_items = function (el_target_container, target_path){
    let dest_path = target_path === undefined ? $(el_target_container).attr('data-path') : target_path;
    let el_items = [];
    if(window.clipboard.length > 0){
        for(let i=0; i<window.clipboard.length; i++){
            el_items.push($(`.item[data-path="${html_encode(window.clipboard[i])}" i]`));
        }
        if(el_items.length > 0)
            window.move_items(el_items, dest_path);
    }

    window.clipboard = [];
}

function downloadFile(url, postData = {}) {
    // Create a hidden iframe to trigger the download
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    // Create a form in the iframe for the POST request
    const form = document.createElement('form');
    form.action = url;
    form.method = 'POST';
    iframe.contentDocument.body.appendChild(form);

    // Add POST data to the form
    Object.entries(postData).forEach(([key, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
    });

    // Submit the form to trigger the download
    form.submit();

    // Cleanup after a short delay (to ensure download starts)
    setTimeout(() => {
        document.body.removeChild(iframe);
    }, 1000);
}

/**
 * Initiates a download for multiple files provided as an array of paths.
 *
 * This function triggers the download of files from given paths. It constructs the
 * download URLs using an API base URL and the given paths, along with an authentication token.
 * Each file is then fetched and prompted to the user for download using the `saveAs` function.
 * 
 * Global dependencies:
 * - `api_origin`: The base URL for the download API endpoint.
 * - `auth_token`: The authentication token required for the download API.
 * - `saveAs`: Function to save the fetched blob as a file.
 * - `path.basename()`: Function to extract the filename from the provided path.
 * 
 * @global
 * @function trigger_download
 * @param {string[]} paths - An array of file paths that are to be downloaded.
 * 
 * @example
 * let filePaths = ['/path/to/file1.txt', '/path/to/file2.png'];
 * window.trigger_download(filePaths);
 */
window.trigger_download = (paths)=>{
    let urls = [];
    for (let index = 0; index < paths.length; index++) {
        urls.push({
            download: window.origin + "/down?path=" + paths[index],
            filename: path.basename(paths[index]),
        });
    }

    urls.forEach(async function (e) {                
        const anti_csrf = await (async () => {
            const resp = await fetch(
                `${window.gui_origin}/get-anticsrf-token`,{
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + window.auth_token,
                    }
                },)
            const { token } = await resp.json();
            return token;
        })();

        downloadFile(e.download, {
            anti_csrf,
            auth_token: puter.authToken,
        });
        return;

        fetch(e.download, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + puter.authToken,
            },
            body: JSON.stringify({
                anti_csrf,
            }),
        })
            .then(res => res.blob())
            .then(blob => {
                saveAs(blob, e.filename);
            });
            
    });
}

/**
 * Moves the given items to the destination path. 
 * 
 * @param {HTMLElement[]} el_items - jQuery elements representing the items to move
 * @param {string} dest_path - The destination path to move the items to
 * @returns {Promise<void>} 
 */
window.move_items = async function(el_items, dest_path, is_undo = false){
    let move_op_id = window.operation_id++;
    window.operation_cancelled[move_op_id] = false;

    // --------------------------------------------------------
    // Optimization: in case all items being moved 
    // are immutable do not proceed
    // --------------------------------------------------------
    let all_items_are_immutable = true;
    for(let i=0; i<el_items.length; i++){
        if($(el_items[i]).attr('data-immutable') === '0'){
            all_items_are_immutable = false;
            break;
        }
    }
    if(all_items_are_immutable)
        return;

    // --------------------------------------------------------
    // good to go, proceed
    // --------------------------------------------------------
    
    // overwrite all items? default is false unless in a conflict case user asks for it 
    let overwrite_all = false; 
    
    // when did this operation start
    let move_init_ts = Date.now();

    // only show progress window if it takes longer than 2s to move
    let progwin;
    let progwin_timeout = setTimeout(async () => {
        progwin = await UIWindowProgress({
            operation_id: move_op_id,
            on_cancel: () => {
                window.operation_cancelled[move_op_id] = true;
            },
        });
    }, 2000);

    // storing moved items for undo ability
    const moved_items = []

    // Go through each item and try to move it
    for(let i=0; i<el_items.length; i++){
        // get current item
        let el_item = el_items[i];

        // if operation cancelled by user, stop
        if(window.operation_cancelled[move_op_id])
            return;

        // cannot move an immutable item, skip it
        if($(el_item).attr('data-immutable') === '1')
            continue;

        // cannot move item to its own path, skip it
        if(path.dirname($(el_item).attr('data-path')) === dest_path){
            await UIAlert(`<p>Moving <strong>${html_encode($(el_item).attr('data-name'))}</strong></p>Cannot move item to its current location.`)

            continue;
        }

        // if an item with the same name already exists in the destination path
        let item_with_same_name_already_exists = false;
        let overwrite = overwrite_all;
        let untrashed_at_least_one_item = false;

        // --------------------------------------------------------
        // Keep trying to move the item until it succeeds or is cancelled
        // or user decides to overwrite or skip
        // --------------------------------------------------------
        do{
            try{
                let path_to_show_on_progwin = $(el_item).attr('data-path');

                // parse metadata if any
                let metadata = $(el_item).attr('data-metadata');

                // no metadata?
                if(metadata === '' || metadata === 'null' || metadata === null)
                    metadata = {}
                // try to parse metadata as JSON
                else{
                    try{
                        metadata = JSON.parse(metadata)
                    }catch(e){
                        // Ignored
                    }
                }

                let new_name;

                // user cancelled?
                if(window.operation_cancelled[move_op_id])
                    return;

                // indicates whether this is a recycling operation
                let recycling = false;

                let status_i18n_string = 'moving_file';

                // --------------------------------------------------------
                // Trashing
                // --------------------------------------------------------
                if(dest_path === window.trash_path){
                    new_name = $(el_item).attr('data-uid');
                    metadata = {
                        original_name: $(el_item).attr('data-name'),
                        original_path: $(el_item).attr('data-path'),
                        trashed_ts: Math.round(Date.now() / 1000),
                    };

                    status_i18n_string = 'deleting_file';

                    // update other clients
                    if(window.socket)
                        window.socket.emit('trash.is_empty', {is_empty: false});

                    // change trash icons to 'trash-full.svg'
                    $(`[data-app="trash"]`).find('.taskbar-icon > img').attr('src', window.icons['trash-full.svg']);
                    $(`.item[data-path="${html_encode(window.trash_path)}" i], .item[data-shortcut_to_path="${html_encode(window.trash_path)}" i]`).find('.item-icon > img').attr('src', window.icons['trash-full.svg']);
                    $(`.window[data-path="${html_encode(window.trash_path)}" i]`).find('.window-head-icon').attr('src', window.icons['trash-full.svg']);
                }

                // moving an item into a trashed directory? deny.
                else if(dest_path.startsWith(window.trash_path)){
                    progwin?.close();
                    UIAlert('Cannot move items into a deleted folder.');
                    return;
                }

                // --------------------------------------------------------
                // If recycling an item, restore its original name
                // --------------------------------------------------------
                else if(metadata.trashed_ts !== undefined){
                    recycling = true;
                    new_name = metadata.original_name;
                    metadata = {};
                    untrashed_at_least_one_item = true;
                    path_to_show_on_progwin = window.trash_path + '/' + new_name;
                }

                // --------------------------------------------------------
                // update progress window with current item being moved
                // --------------------------------------------------------
                progwin?.set_status(i18n(status_i18n_string, path_to_show_on_progwin));

                // execute move
                let resp = await puter.fs.move({
                    source: $(el_item).attr('data-uid'),
                    destination: dest_path,
                    overwrite: overwrite || overwrite_all,
                    newName: new_name,
                    // recycling requires making all missing dirs
                    createMissingParents: recycling,
                    newMetadata: metadata,
                    excludeSocketID: window.socket?.id,
                });

                let fsentry = resp.moved;

                // path must use the real name from DB
                fsentry.path =  path.join(dest_path, fsentry.name);

                // skip next loop iteration because this iteration was successful
                item_with_same_name_already_exists = false;

                // update all shortcut_to_path
                $(`.item[data-shortcut_to_path="${html_encode($(el_item).attr('data-path'))}" i]`).attr(`data-shortcut_to_path`, fsentry.path);

                // Remove all items with matching uids
                $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).fadeOut(150, function(){
                    // find all parent windows that contain this item
                    let parent_windows = $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).closest('.window');
                    // remove this item
                    $(this).removeItems();
                    // update parent windows' item counts and selected item counts in their footers
                    $(parent_windows).each(function(){
                        window.update_explorer_footer_item_count(this);
                        window.update_explorer_footer_selected_items_count(this)
                    });
                })

                // if trashing, close windows of trashed items and its descendants
                if(dest_path === window.trash_path){
                    $(`.window[data-path="${html_encode($(el_item).attr('data-path'))}" i]`).close();
                    // todo this has to be case-insensitive but the `i` selector doesn't work on ^=
                    $(`.window[data-path^="${html_encode($(el_item).attr('data-path'))}/"]`).close();
                }

                // update all paths of its and its descendants' open windows
                else{
                    // todo this has to be case-insensitive but the `i` selector doesn't work on ^=
                    $(`.window[data-path^="${html_encode($(el_item).attr('data-path'))}/"], .window[data-path="${html_encode($(el_item).attr('data-path'))}" i]`).each(function(){
                        window.update_window_path(this, $(this).attr('data-path').replace($(el_item).attr('data-path'), path.join(dest_path, fsentry.name)));
                    })
                }

                if(dest_path === window.trash_path){
                    // if trashing dir... 
                    if($(el_item).attr('data-is_dir') === '1'){
                        // disassociate all its websites
                        // todo, some client-side check to see if this dir has at least one associated website before sending ajax request
                        // FIXME: dir_uuid is not defined, is this the same as the data-uid attribute?
                        // puter.hosting.delete(dir_uuid)

                        $(`.mywebsites-dir-path[data-uuid="${$(el_item).attr('data-uid')}"]`).remove();
                        // remove the website badge from all instances of the dir
                        $(`.item[data-uid="${$(el_item).attr('data-uid')}"]`).find('.item-has-website-badge').fadeOut(300);
                    }
                }

                // if replacing an existing item, remove the old item that was just replaced
                if(resp.overwritten?.id){
                    $(`.item[data-uid=${resp.overwritten.id}]`).removeItems();
                }

                // if this is trash, get original name from item metadata
                fsentry.name = metadata?.original_name || fsentry.name;

                // create new item on matching containers
                const options = {
                    appendTo: $(`.item-container[data-path="${html_encode(dest_path)}" i]`),
                    immutable: fsentry.immutable || (fsentry.writable === false),
                    associated_app_name: fsentry.associated_app?.name,
                    uid: fsentry.uid,
                    path: fsentry.path,
                    icon: await item_icon(fsentry),
                    name: (dest_path === window.trash_path) ? $(el_item).attr('data-name') : fsentry.name,
                    is_dir: fsentry.is_dir,
                    size: fsentry.size,
                    type: fsentry.type,
                    modified: fsentry.modified,
                    is_selected: false,
                    is_shared: (dest_path === window.trash_path) ? false : fsentry.is_shared,
                    is_shortcut: fsentry.is_shortcut,
                    shortcut_to: fsentry.shortcut_to,
                    shortcut_to_path: fsentry.shortcut_to_path,
                    has_website: $(el_item).attr('data-has_website') === '1',
                    metadata: fsentry.metadata ?? '',
                    suggested_apps: fsentry.suggested_apps,
                }
                UIItem(options);
                moved_items.push({'options': options, 'original_path': $(el_item).attr('data-path')});

                // this operation may have created some missing directories, 
                // see if any of the directories in the path of this file is new AND
                // if these new path have any open parents that need to be updated
                resp.parent_dirs_created?.forEach(async dir => {
                    let item_container = $(`.item-container[data-path="${html_encode(path.dirname(dir.path))}" i]`);
                    if(item_container.length > 0 && $(`.item[data-path="${html_encode(dir.path)}" i]`).length === 0){
                        UIItem({
                            appendTo: item_container,
                            immutable: false,
                            uid: dir.uid,
                            path: dir.path,
                            icon: await item_icon(dir),
                            name: dir.name,
                            size: dir.size,
                            type: dir.type,
                            modified: dir.modified,
                            is_dir: true,
                            is_selected: false,
                            is_shared: dir.is_shared,
                            has_website: false,
                            suggested_apps: dir.suggested_apps,
                        });
                    }
                    window.sort_items(item_container);
                }); 

                //sort each container
                $(`.item-container[data-path="${html_encode(dest_path)}" i]`).each(function(){
                    window.sort_items(this, $(this).attr('data-sort_by'), $(this).attr('data-sort_order'))
                })
            }catch(err){
                // -----------------------------------------------------------------------
                // if item with same name already exists, ask user if they want to overwrite
                // -----------------------------------------------------------------------
                if(err.code==='item_with_same_name_exists'){
                    item_with_same_name_already_exists = true;

                    const alert_resp = await UIAlert({
                        message: `<strong>${html_encode(err.entry_name)}</strong> already exists.`,
                        buttons:[
                            { label: i18n('replace'), type: 'primary', value: 'replace' },
                            ... (el_items.length > 1) ? [{label: i18n('replace_all'), value: 'replace_all'}] : [],
                            ... (el_items.length > 1) ? [{label: i18n('skip'), value: 'skip'}] : [{label: i18n('cancel'), value: 'cancel'}],
                        ]
                    })
                    if(alert_resp === 'replace'){
                        overwrite = true;
                    }else if (alert_resp === 'replace_all'){
                        overwrite = true;
                        overwrite_all = true;
                    }else if(alert_resp === 'skip' || alert_resp === 'cancel'){
                        item_with_same_name_already_exists = false;
                    }
                }
                // -----------------------------------------------------------------------
                // all other errors
                // -----------------------------------------------------------------------
                else{
                    item_with_same_name_already_exists = false;
                    // error message after source item has reappeared
                    $(el_item).show(0, function(){
                        UIAlert(`<p>Moving <strong>${html_encode($(el_item).attr('data-name'))}</strong></p>${err.message ?? ''}`)
                    });

                    break;
                }
            }
        }while(item_with_same_name_already_exists);

        // check if trash is empty
        if(untrashed_at_least_one_item){
            const trash = await puter.fs.stat(window.trash_path);
            if(window.socket){
                window.socket.emit('trash.is_empty', {is_empty: trash.is_empty});
            }
            if(trash.is_empty){
                $(`[data-app="trash"]`).find('.taskbar-icon > img').attr('src', window.icons['trash.svg']);
                $(`.item[data-path="${html_encode(window.trash_path)}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
                $(`.window[data-path="${html_encode(window.trash_path)}" i]`).find('.window-head-icon').attr('src', window.icons['trash.svg']);
            }
        }
    }

    clearTimeout(progwin_timeout);

    // log stats to console
    let move_duration = (Date.now() - move_init_ts);
    // console.log(`moved ${el_items.length} item${el_items.length > 1 ? 's':''} in ${move_duration}ms`);

    // -----------------------------------------------------------------------
    // DONE! close progress window with delay to allow user to see 100% progress
    // -----------------------------------------------------------------------
    // Add action to actions_history for undo ability
    if(!is_undo && dest_path !== window.trash_path){
        window.actions_history.push({
            operation: 'move',
            data: moved_items,
        });
    }else if(!is_undo && dest_path === window.trash_path){
        window.actions_history.push({
            operation: 'delete',
            data: moved_items,
        });
    }

    if(progwin){
        setTimeout(() => {
            progwin.close();
        }, window.copy_progress_hide_delay);
    }
}

/**
 * Refreshes the desktop background based on the user's settings.
 * If the user has set a custom desktop background URL or color, it will use that.
 * If not, it defaults to a specific wallpaper image.
 *
 * @global
 * @function
 * @fires set_desktop_background - Calls this global function to set the desktop background.
 * 
 * @example
 * // This will refresh the desktop background according to the user's preference or defaults.
 * window.refresh_desktop_background();
 */
window.refresh_desktop_background = function(){
    if(window.user && (window.user.desktop_bg_url !== null || window.user.desktop_bg_color !== null)){
        window.set_desktop_background({
            url: window.user.desktop_bg_url,
            fit: window.user.desktop_bg_fit,
            color: window.user.desktop_bg_color,
        })
    }
    // default background
    else{
        let wallpaper = (window.gui_env === 'prod') ? '/dist/images/wallpaper.webp' :  '/src/images/wallpaper.webp';
        window.set_desktop_background({
            url: wallpaper,
            fit: 'cover',
        });
    }
}

window.determine_website_url = function(fsentry_path){
    // search window.sites and if any site has `dir_path` set and the fsentry_path starts with that dir_path + '/', return the site's url + path
    for(let i=0; i<window.sites.length; i++){
        if(window.sites[i].dir_path && fsentry_path.startsWith(window.sites[i].dir_path + '/')){
            return window.sites[i].address + fsentry_path.replace(window.sites[i].dir_path, '');
        }
    }

    return null;
}

window.update_sites_cache = function(){
    return puter.hosting.list((sites)=>{
        if(sites && sites.length > 0){
            window.sites = sites;
        }else{
            window.sites = [];
        }
    })
}

/**
 * 
 * @param {*} el_target_container 
 * @param {*} target_path 
 */

window.init_upload_using_dialog = function(el_target_container, target_path = null){
    $("#upload-file-dialog").unbind('onchange');
    $("#upload-file-dialog").unbind('change');
    $("#upload-file-dialog").unbind('onChange');

    target_path = target_path === null ? $(el_target_container).attr('data-path') : path.resolve(target_path);
    $('#upload-file-dialog').trigger('click');
    $("#upload-file-dialog").on('change', async function(e){        
        if($("#upload-file-dialog").val() !== ''){            
            const files = $('#upload-file-dialog')[0].files;
            if(files.length > 0){
                try{
                    window.upload_items(files, target_path);
                }
                catch(err){
                    UIAlert(err.message ?? err)
                }
                $('#upload-file-dialog').val('');
            }
        }
        else{
            return
        }
    })
}

window.upload_items = async function(items, dest_path){
    let upload_progress_window;
    let opid;

    if(dest_path == window.trash_path){
        UIAlert('Uploading to trash is not allowed!');
        return;
    }

    puter.fs.upload(
        // what to upload
        items, 
        // where to upload
        dest_path,
        // options
        {
            // init
            init: async(operation_id, xhr)=>{
                opid = operation_id;
                // create upload progress window
                upload_progress_window = await UIWindowProgress({
                    title: i18n('upload'),
                    icon: window.icons[`app-icon-uploader.svg`],
                    operation_id: operation_id,
                    show_progress: true,
                    on_cancel: () => {
                        window.show_save_account_notice_if_needed();
                        xhr.abort();
                    },
                });
                // add to active_uploads
                window.active_uploads[opid] = 0;
            },
            // start
            start: async function(){
                // change upload progress window message to uploading
                upload_progress_window.set_status('Uploading');
                upload_progress_window.set_progress(0);
            },
            // progress
            progress: async function(operation_id, op_progress){
                upload_progress_window.set_progress(op_progress);
                // update active_uploads
                window.active_uploads[opid] = op_progress;
                // update title if window is not visible
                if(document.visibilityState !== "visible"){
                    update_title_based_on_uploads();
                }
            },
            // success
            success: async function(items){
                // DONE
                // Add action to actions_history for undo ability
                const files = []
                if(typeof items[Symbol.iterator] === 'function'){
                    for(const item of items){
                        files.push(item.path)
                    }
                }else{
                    files.push(items.path)
                }

                window.actions_history.push({
                    operation: 'upload',
                    data: files
                });
                // close progress window after a bit of delay for a better UX
                setTimeout(() => {
                    setTimeout(() => {
                        upload_progress_window.close();
                        window.show_save_account_notice_if_needed();
                    }, Math.abs(window.upload_progress_hide_delay));
                })
                // remove from active_uploads
                delete window.active_uploads[opid];
            },
            // error
            error: async function(err){
                upload_progress_window.show_error(i18n('error_uploading_files'), err.message);
                // remove from active_uploads
                delete window.active_uploads[opid];
            },
            // abort
            abort: async function(operation_id){
                // remove from active_uploads
                delete window.active_uploads[opid];
            }
        }
    );
}

window.empty_trash = async function(){
    const alert_resp = await UIAlert({
        message: i18n('empty_trash_confirmation'),
        buttons:[
            {
                label: i18n('yes'),
                value: 'yes',
                type: 'primary',
            },
            {
                label: i18n('no'),
                value: 'no',
            },
        ]
    })
    if(alert_resp === 'no')
        return;

    // only show progress window if it takes longer than 500ms to create folder
    let init_ts = Date.now();
    let progwin;
    let op_id = window.uuidv4();
    let progwin_timeout = setTimeout(async () => {
        progwin = await UIWindowProgress({operation_id: op_id});
        progwin.set_status(i18n('emptying_trash'));
    }, 500);

    await puter.fs.delete({
        paths: window.trash_path,
        descendantsOnly: true,
        recursive: true,
        success: async function (resp){
            // update other clients
            if(window.socket){
                window.socket.emit('trash.is_empty', {is_empty: true});
            }
            // use the 'empty trash' icon for Trash
            $(`[data-app="trash"]`).find('.taskbar-icon > img').attr('src', window.icons['trash.svg']);
            $(`.item[data-path="${html_encode(window.trash_path)}" i], .item[data-shortcut_to_path="${html_encode(window.trash_path)}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
            $(`.window[data-path="${window.trash_path}"]`).find('.window-head-icon').attr('src', window.icons['trash.svg']);
            // remove all items with trash paths
            // todo this has to be case-insensitive but the `i` selector doesn't work on ^=
            $(`.item[data-path^="${window.trash_path}/"]`).removeItems();
            // update the footer item count for Trash
            window. update_explorer_footer_item_count($(`.window[data-path="${window.trash_path}"]`))
            // close progress window
            clearTimeout(progwin_timeout);
            setTimeout(() => {
                progwin?.close();
            }, Math.max(0, window.copy_progress_hide_delay - (Date.now() - init_ts)));
        },
        error: async function (err){
            clearTimeout(progwin_timeout);
            setTimeout(() => {
                progwin?.close();
            }, Math.max(0, window.copy_progress_hide_delay - (Date.now() - init_ts)));
        }
    });
}

window.copy_to_clipboard = async function(text){
    if (navigator.clipboard) {
        // copy text to clipboard
        await navigator.clipboard.writeText(text);
    }
    else{
        document.execCommand('copy');
    }
}

window.getUsage = () => {
    return fetch(window.api_origin + "/drivers/usage", {
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + window.auth_token
        },
        method: "GET"
    })
    .then(response => {
        // Check if the response is ok (status code in the range 200-299)
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json(); // Parse the response as JSON
    })
    .then(data => {
        // Handle the JSON data
        return data;
    })
    .catch(error => {
        // Handle any errors
        console.error('There has been a problem with your fetch operation:', error);
    });

}  

window.getAppUIDFromOrigin = async function(origin) {
    try {
        const response = await fetch(window.api_origin + "/auth/app-uid-from-origin", {
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + window.auth_token,
            },
            body: JSON.stringify({ origin: origin }),
            method: "POST",
        });

        const data = await response.json();

        // Assuming the app_uid is in the data object, return it
        return data.uid;
    } catch (err) {
        // Handle any errors here
        console.error(err);
        // You may choose to return something specific here in case of an error
        return null;
    }
}

window.getUserAppToken = async function(origin) {
    try {
        const response = await fetch(window.api_origin + "/auth/get-user-app-token", {
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + window.auth_token,
            },
            body: JSON.stringify({ origin: origin }),
            method: "POST",
        });

        const data = await response.json();

        // return
        return data;
    } catch (err) {
        // Handle any errors here
        console.error(err);
        // You may choose to return something specific here in case of an error
        return null;
    }
}

window.checkUserSiteRelationship = async function(origin) {
    try {
        const response = await fetch(window.api_origin + "/auth/check-app ", {
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + window.auth_token,
            },
            body: JSON.stringify({ origin: origin }),
            method: "POST",
        });

        const data = await response.json();

        // return
        return data;
    } catch (err) {
        // Handle any errors here
        console.error(err);
        // You may choose to return something specific here in case of an error
        return null;
    }
}

// Converts a Blob to a Uint8Array [local helper module]
async function blobToUint8Array(blob) {
    const totalLength = blob.size;
    const reader = blob.stream().getReader();
    let chunks = [];
    let receivedLength = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedLength += value.length;
    }
    let uint8Array = new Uint8Array(receivedLength);
    let position = 0;

    for (let chunk of chunks) {
        uint8Array.set(chunk, position);
        position += chunk.length;
    }
    return uint8Array;
}

window.zipItems = async function(el_items, targetDirPath, download = true) {
    const zip_operation_id = window.operation_id++;
    window.operation_cancelled[zip_operation_id] = false;
    let terminateOp = () => {}

    // if single item, convert to array
    el_items = Array.isArray(el_items) ? el_items : [el_items];

    // create progress window
    let start_ts = Date.now();
    let progwin, progwin_timeout;
    // only show progress window if it takes longer than 500ms
    progwin_timeout = setTimeout(async () => {
        progwin = await UIWindowProgress({
            title: i18n('zip'),
            icon: window.icons[`app-icon-uploader.svg`],
            operation_id: zip_operation_id,
            show_progress: true,
            on_cancel: () => {
                window.operation_cancelled[zip_operation_id] = true;
                terminateOp();
            },
        });
        progwin?.set_status(i18n('zip', 'Selection(s)'));
    }, 500);

    let toBeZipped = {};
    
    let perItemAdditionProgress = window.zippingProgressConfig.SEQUENCING / el_items.length;
    let currentProgress = 0;
    for (let idx = 0; idx < el_items.length; idx++) {
        const el_item = el_items[idx];
        if(window.operation_cancelled[zip_operation_id]) return;
        let targetPath = $(el_item).attr('data-path');

        // if directory, zip the directory
        if($(el_item).attr('data-is_dir') === '1'){
            progwin?.set_status(i18n('reading', path.basename(targetPath)));
            // Recursively read the directory
            let children = await readDirectoryRecursive(targetPath);

            // Add files to the zip
            for (let cIdx = 0; cIdx < children.length; cIdx++) {
                const child = children[cIdx];
                
                if (!child.relativePath) {
                    // Add empty directiories to the zip
                    toBeZipped = {
                        ...toBeZipped,
                        [path.basename(child.path)+"/"]: [await blobToUint8Array(new Blob()), { level: 9 }]
                    }
                } else {
                    // Add files from directory to the zip
                    let relativePath;
                    if (el_items.length === 1)
                        relativePath = child.relativePath;
                    else
                        relativePath = path.basename(targetPath) + '/' + child.relativePath;

                    // read file content
                    progwin?.set_status(i18n('sequencing', child.relativePath));
                    let content = await puter.fs.read(child.path);
                    try {
                        toBeZipped = {
                            ...toBeZipped,
                            [relativePath]: [await blobToUint8Array(content), { level: 9 }]
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }
                currentProgress += perItemAdditionProgress / children.length;
                progwin?.set_progress(currentProgress.toPrecision(2));
            }
        }
        // if item is a file, add the file to be zipped
        else{
            progwin?.set_status(i18n('reading', path.basename($(el_items[0]).attr('data-path'))));
            let content = await puter.fs.read(targetPath)
            toBeZipped = {
                ...toBeZipped,
                [path.basename(targetPath)]: [await blobToUint8Array(content), {level: 9}]
            }
            currentProgress += perItemAdditionProgress;
            progwin?.set_progress(currentProgress.toPrecision(2));
        }
    }

    // determine name of zip file
    let zipName;
    if(el_items.length === 1)
        zipName = path.basename($(el_items[0]).attr('data-path'));
    else
        zipName = 'Archive';

    progwin?.set_status(i18n('zipping', zipName + ".zip"));
    progwin?.set_progress(currentProgress.toPrecision(2));
    terminateOp = fflate.zip(toBeZipped, { level: 9 }, async (err, zippedContents)=>{
        currentProgress += window.zippingProgressConfig.ZIPPING;
        if(err) {
            // close progress window
            clearTimeout(progwin_timeout);
            setTimeout(() => {
                progwin?.close();
            }, Math.max(0, window.copy_progress_hide_delay - (Date.now() - start_ts)));
            // handle errors
            // TODO: Display in progress dialog
            console.error("Error in zipping files: ", err);
        } else {
            let zippedBlob = new Blob([new Uint8Array(zippedContents, zippedContents.byteOffset, zippedContents.length)]);
            
            // Trigger the download
            if(download){
                const url = URL.createObjectURL(zippedBlob);
                const a = document.createElement("a");
                a.href = url;
                a.download = zipName+".zip";
                document.body.appendChild(a);
                a.click();

                // Cleanup
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
            // save
            else {
                progwin?.set_status(i18n('writing', zipName + ".zip"));
                currentProgress += window.zippingProgressConfig.WRITING;
                progwin?.set_progress(currentProgress.toPrecision(2));
                await puter.fs.write(targetDirPath + '/' + zipName + ".zip", zippedBlob, { overwrite: false, dedupeName: true })
                progwin?.set_progress(window.zippingProgressConfig.TOTAL);
            }

            // close progress window
            clearTimeout(progwin_timeout);
            setTimeout(() => {
                progwin?.close();
            }, Math.max(0, window.zip_progress_hide_delay - (Date.now() - start_ts)));
        }
    });
}

async function readDirectoryRecursive(path, baseDir = '') {
    let allFiles = [];

    // Read the directory
    const entries = await puter.fs.readdir(path);

    if (entries.length === 0) {
        allFiles.push({ path });
    } else {
        // Process each entry
        for (const entry of entries) {
            const fullPath = `${path}/${entry.name}`;
            if (entry.is_dir) {
                // If entry is a directory, recursively read it
                const subDirFiles = await readDirectoryRecursive(fullPath, `${baseDir}${entry.name}/`);
                allFiles = allFiles.concat(subDirFiles);
            } else {
                // If entry is a file, add it to the list
                allFiles.push({ path: fullPath, relativePath: `${baseDir}${entry.name}` });
            }
        }
    }

    return allFiles;
}


window.extractSubdomain = function(url) {
    var subdomain = url.split('://')[1].split('.')[0];
    return subdomain;
}

window.extractProtocol = function (url) {
    var protocol = url.split('://')[0];
    return protocol;
}
window.sleep = function(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}

window.unzipItem = async function(itemPath) {
    const unzip_operation_id = window.operation_id++;
    window.operation_cancelled[unzip_operation_id] = false;
    let terminateOp = () => {};
    // create progress window
    let start_ts = Date.now();
    let progwin, progwin_timeout;
    // only show progress window if it takes longer than 500ms to download
    progwin_timeout = setTimeout(async () => {
        progwin = await UIWindowProgress({
            title: i18n('unzip'),
            icon: window.icons[`app-icon-uploader.svg`],
            operation_id: unzip_operation_id,
            show_progress: true,
            on_cancel: () => {
                window.operation_cancelled[unzip_operation_id] = true;
                terminateOp();
            },
        });
        progwin?.set_status(i18n('unzip', 'Selection'));
    }, 500);

    let filePath = itemPath;
    let currentProgress = window.zippingProgressConfig.SEQUENCING;

    progwin?.set_status(i18n('sequencing', path.basename(filePath)));
    let file = await blobToUint8Array(await puter.fs.read(filePath));
    progwin?.set_progress(currentProgress.toPrecision(2));

    progwin?.set_status(i18n('unzipping', path.basename(filePath)));
    terminateOp = fflate.unzip(file, async (err, unzipped) => {
        currentProgress += window.zippingProgressConfig.ZIPPING;
        progwin?.set_progress(currentProgress.toPrecision(2));
        if(err) {
            UIAlert(e.message);
            // close progress window
            clearTimeout(progwin_timeout);
            setTimeout(() => {
                progwin?.close();
            }, Math.max(0, window.copy_progress_hide_delay - (Date.now() - start_ts)));
        } else {
            const rootdir = await puter.fs.mkdir(path.dirname(filePath) + '/' + path.basename(filePath, '.zip'), { dedupeName: true });
            let perItemProgress = window.zippingProgressConfig.WRITING / Object.keys(unzipped).length;
            let queuedFileWrites = []
            Object.keys(unzipped).forEach(fileItem => {
                try {
                    let fileData = new Blob([new Uint8Array(unzipped[fileItem], unzipped[fileItem].byteOffset, unzipped[fileItem].length)]);
                    progwin?.set_status(i18n('writing', fileItem));
                    queuedFileWrites.push(new File([fileData], fileItem))
                    currentProgress += perItemProgress;
                    progwin?.set_progress(currentProgress.toPrecision(2));
                } catch (e) {
                    UIAlert(e.message);
                }
            });
            queuedFileWrites.length && puter.fs.upload(
                // what to upload
                queuedFileWrites, 
                // where to upload
                rootdir.path + '/',
                // options
                {
                    createFileParent: true,
                    progress: async function(operation_id, op_progress){
                        progwin.set_progress(op_progress);
                        // update title if window is not visible
                        if(document.visibilityState !== "visible"){
                            update_title_based_on_uploads();
                        }
                    },
                    success: async function(items){
                        progwin?.set_progress(window.zippingProgressConfig.TOTAL.toPrecision(2));
                        // close progress window
                        clearTimeout(progwin_timeout);
                        setTimeout(() => {
                            progwin?.close();
                        }, Math.max(0, window.unzip_progress_hide_delay - (Date.now() - start_ts)));
                    }
                }
            );
        }
    });
}

window.rename_file = async(options, new_name, old_name, old_path, el_item, el_item_name, el_item_icon, el_item_name_editor, website_url, is_undo = false)=>{
    puter.fs.rename({
        uid: options.uid === 'null' ? null : options.uid,
        new_name: new_name,
        excludeSocketID: window.socket.id,
        success: async (fsentry)=>{
            // Add action to actions_history for undo ability
            if (!is_undo)
                window.actions_history.push({
                    operation: 'rename',
                    data: {options, new_name, old_name, old_path, el_item, el_item_name, el_item_icon, el_item_name_editor, website_url}
                });
            
            // Has the extension changed? in that case update options.sugggested_apps
            const old_extension = path.extname(old_name); 
            const new_extension = path.extname(new_name);
            if(old_extension !== new_extension){
                window.suggest_apps_for_fsentry({
                    uid: options.uid,
                    onSuccess: function(suggested_apps){
                        options.suggested_apps = suggested_apps;
                    }
                });
            }

            // Set new item name
            $(`.item[data-uid='${$(el_item).attr('data-uid')}'] .item-name`).html(html_encode(truncate_filename(new_name)));
            $(el_item_name).show();

            // Hide item name editor
            $(el_item_name_editor).hide();

            // Set new icon
            const new_icon = (options.is_dir ? window.icons['folder.svg'] : (await item_icon(fsentry)).image);
            $(el_item_icon).find('.item-icon-icon').attr('src', new_icon);

            // Set new `data-name`
            options.name = new_name;
            $(el_item).attr('data-name', html_encode(new_name));
            $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).attr('data-name', html_encode(new_name));
            $(`.window-${options.uid}`).attr('data-name', html_encode(new_name));

            // Set new `title` attribute
            $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).attr('title', html_encode(new_name));
            $(`.window-${options.uid}`).attr('title', html_encode(new_name));

            // Set new value for `item-name-editor`
            $(`.item[data-uid='${$(el_item).attr('data-uid')}'] .item-name-editor`).val(html_encode(new_name));
            $(`.item[data-uid='${$(el_item).attr('data-uid')}'] .item-name`).attr('title', html_encode(new_name));

            // Set new `data-path` attribute
            options.path = path.join( path.dirname(options.path), options.name);
            const new_path = options.path;
            $(el_item).attr('data-path', new_path);
            $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).attr('data-path', new_path);
            $(`.window-${options.uid}`).attr('data-path', new_path);

            // Update all elements that have matching paths
            $(`[data-path="${html_encode(old_path)}" i]`).each(function(){
                $(this).attr('data-path', new_path)
                if($(this).hasClass('window-navbar-path-dirname'))
                    $(this).text(new_name);
            });

            // Update the paths of all elements whose paths start with `old_path`
            $(`[data-path^="${html_encode(old_path) + '/'}"]`).each(function(){
                const new_el_path = _.replace($(this).attr('data-path'), old_path + '/', new_path+'/');
                $(this).attr('data-path', new_el_path);
            });

            // Update the 'Sites Cache'
            if($(el_item).attr('data-has_website') === '1')
                await window.update_sites_cache();

            // Update `website_url`
            website_url = window.determine_website_url(new_path);
            $(el_item).attr('data-website_url', website_url);

            // Update all exact-matching windows
            $(`.window-${options.uid}`).each(function(){
                window.update_window_path(this, options.path);
            })

            // Set new name for corresponding open windows
            $(`.window-${options.uid} .window-head-title`).text(new_name);

            // Re-sort all matching item containers
            $(`.item[data-uid='${$(el_item).attr('data-uid')}']`).parent('.item-container').each(function(){
                window.sort_items(this, $(el_item).closest('.item-container').attr('data-sort_by'), $(el_item).closest('.item-container').attr('data-sort_order'));
            })
        },
        error: function (err){
            // reset to old name
            $(el_item_name).text(truncate_filename(options.name));
            $(el_item_name).show();

            // hide item name editor
            $(el_item_name_editor).hide();
            $(el_item_name_editor).val(html_encode($(el_item).attr('data-name')));

            //show error
            if(err.message){
                UIAlert(err.message)
            }
        },
    });
}

/**
 * Deletes the given item with path.
 * 
 * @param {string} path - path of the item to delete 
 * @returns {Promise<void>}
 */
window.delete_item_with_path = async function(path){
    try{
        await puter.fs.delete({
            paths: path,
            descendantsOnly: false,
            recursive: true,
        });
    }catch(err){
        UIAlert(err.responseText);
    }
}

window.undo_last_action = async()=>{
    if (window.actions_history.length > 0) {
        const last_action = window.actions_history.pop();

        // Undo the create file action
        if (last_action.operation === 'create_file' || last_action.operation === 'create_folder') {
            const lastCreatedItem = last_action.data;
            window.undo_create_file_or_folder(lastCreatedItem);
        } else if(last_action.operation === 'rename') {
            const {options, new_name, old_name, old_path, el_item, el_item_name, el_item_icon, el_item_name_editor, website_url}  = last_action.data;
            window.rename_file(options, old_name, new_name, old_path, el_item, el_item_name, el_item_icon, el_item_name_editor, website_url, true);
        } else if(last_action.operation === 'upload') {
            const files = last_action.data;
            window.undo_upload(files);
        } else if(last_action.operation === 'copy') {
            const files = last_action.data;
            window.undo_copy(files);
        } else if(last_action.operation === 'move') {
            const items = last_action.data;
            window.undo_move(items);
        } else if(last_action.operation === 'delete') {
            const items = last_action.data;
            window.undo_delete(items);
        }
    }
}

window.undo_create_file_or_folder = async(item)=>{
    await window.delete_item(item);
}

window.undo_upload = async(files)=>{
    for (const file of files) {
        await window.delete_item_with_path(file);
    }
}

window.undo_copy = async(files)=>{
    for (const file of files) {
        await window.delete_item_with_path(file);
    }
}

window.undo_move = async(items)=>{
    for (const item of items) {
        const el = await get_html_element_from_options(item.options);
        window.move_items([el], path.dirname(item.original_path), true);
    }
}

window.undo_delete = async(items)=>{
    for (const item of items) {
        const el = await get_html_element_from_options(item.options);
        let metadata = $(el).attr('data-metadata') === '' ? {} : JSON.parse($(el).attr('data-metadata'))
        window.move_items([el], path.dirname(metadata.original_path), true);
    }
}

window.store_auto_arrange_preference = (preference)=>{
    puter.kv.set('user_preferences.auto_arrange_desktop', preference);
    localStorage.setItem('auto_arrange', preference);
}

window.get_auto_arrange_data = async()=>{
    const preferenceValue = await puter.kv.get('user_preferences.auto_arrange_desktop');
    window.is_auto_arrange_enabled = preferenceValue === null ? true : preferenceValue;
    const positions = await puter.kv.get('desktop_item_positions')
    window.desktop_item_positions =  (!positions || typeof positions !== 'object' || Array.isArray(positions)) ? {} : positions;
}

window.clear_desktop_item_positions = async(el_desktop)=>{
    $(el_desktop).find('.item').each(function(){
        const el_item = $(this)[0];
        $(el_item).css('position', '');
        $(el_item).css('left', '');
        $(el_item).css('top', '');
    });
    if(window.reset_item_positions){
        window.delete_desktop_item_positions()
    }
}

window.set_desktop_item_positions = async(el_desktop)=>{
    $(el_desktop).find('.item').each(async function(){
        const position = window.desktop_item_positions[$(this).attr('data-uid')]
        const el_item = $(this)[0];
        if(position){
            $(el_item).css('position', 'absolute');
            $(el_item).css('left', position.left + 'px');
            $(el_item).css('top', position.top + 'px');
        }
    });
}

window.save_desktop_item_positions = ()=>{
    puter.kv.set('desktop_item_positions', window.desktop_item_positions);
}

window.delete_desktop_item_positions = ()=>{
    window.desktop_item_positions = {}
    puter.kv.del('desktop_item_positions');
}

window.change_clock_visible = (clock_visible) => {
    let newValue = clock_visible || window.user_preferences.clock_visible;
    
    
    newValue === 'auto' && window.is_fullscreen() ? $('#clock').show() : $('#clock').hide();

    newValue === 'show' && $('#clock').show();
    newValue === 'hide' && $('#clock').hide();

    if(clock_visible) {
        // save clock_visible to user preferences
        window.mutate_user_preferences({
            clock_visible: newValue
        });

        return;
    }

    $('select.change-clock-visible').val(window.user_preferences.clock_visible);
}

// Finds the `.window` element for the given app instance ID
window.window_for_app_instance = (instance_id) => {
    return $(`.window[data-element_uuid="${instance_id}"]`).get(0);
};

// Finds the `iframe` element for the given app instance ID
window.iframe_for_app_instance = (instance_id) => {
    return $(window.window_for_app_instance(instance_id)).find('.window-app-iframe').get(0);
};

// Run any callbacks to say that the app has launched
window.report_app_launched = (instance_id, { uses_sdk = true }) => {
    const child_launch_callback = window.child_launch_callbacks[instance_id];
    if (child_launch_callback) {
        const parent_iframe = window.iframe_for_app_instance(child_launch_callback.parent_instance_id);
        // send confirmation to requester window
        parent_iframe.contentWindow.postMessage({
            msg: 'childAppLaunched',
            original_msg_id: child_launch_callback.launch_msg_id,
            child_instance_id: instance_id,
            uses_sdk: uses_sdk,
        }, '*');
        delete window.child_launch_callbacks[instance_id];
    }
};

// Run any callbacks to say that the app has closed
// ref(./services/ExecService.js): this is called from ExecService.js on
//   close if the app does not use puter.js
window.report_app_closed = (instance_id, status_code) => {
    const el_window = window.window_for_app_instance(instance_id);

    // notify parent app, if we have one, that we're closing
    const parent_id = el_window.dataset['parent_instance_id'];
    const parent = $(`.window[data-element_uuid="${parent_id}"] .window-app-iframe`).get(0);
    if (parent) {
        parent.contentWindow.postMessage({
            msg: 'appClosed',
            appInstanceID: instance_id,
            statusCode: status_code ?? 0,
        }, '*');
    }

    // notify child apps, if we have them, that we're closing
    const children = $(`.window[data-parent_instance_id="${instance_id}"] .window-app-iframe`);
    children.each((_, child) => {
        child.contentWindow.postMessage({
            msg: 'appClosed',
            appInstanceID: instance_id,
            statusCode: status_code ?? 0,
        }, '*');
    });

    // TODO: Once other AppConnections exist, those will need notifying too.
};

window.set_menu_item_prop = (items, item_id, prop, val) => {
    // iterate over items
    for (const item of items) {
        // find the item with the given item_id
        if (item.id === item_id) {
            // set the property value
            item[prop] = val;
            break;
        }
        else if(item.items){
            set_menu_item_prop(item.items, item_id, prop, val);
        }
    }
};

window.countSubstr = (str, substring)=>{
    if (substring.length === 0) {
        return 0;
    }

    let count = 0;
    let pos = str.indexOf(substring);

    while (pos !== -1) {
        count++;
        pos = str.indexOf(substring, pos + 1);
    }

    return count;
}

window.detectHostOS = function(){
    var userAgent = window.navigator.userAgent;
    var platform = window.navigator.platform;
    var macosPlatforms = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'];
    var windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE'];

    if (macosPlatforms.indexOf(platform) !== -1) {
        return 'macos';
    } else if (windowsPlatforms.indexOf(platform) !== -1) {
        return 'windows';
    } else {
        return 'other';
    }
}

window.update_profile = function(username, key_vals){
    puter.fs.read('/'+username+'/Public/.profile').then((blob)=>{
        blob.text()
        .then(text => {
            const profile = JSON.parse(text);

            for (const key in key_vals) {
                profile[key] = key_vals[key];
                // update window.user.profile
                window.user.profile[key] = key_vals[key];
            }

            puter.fs.write('/'+username+'/Public/.profile', JSON.stringify(profile));
        })
        .catch(error => {
            console.error('Error converting Blob to JSON:', error);
        });
    }).catch((e)=>{
        if(e?.code === "subject_does_not_exist"){
            // create .profile file
            puter.fs.write('/'+username+'/Public/.profile', JSON.stringify({}));
        }
        // Ignored
        console.log(e);
    });
}

window.blob2str = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
}

window.get_profile_picture = async function(username){
    let icon;
    // try getting profile pic
    try{
        let stat = await puter.fs.stat('/' + username + '/Public/.profile');
        if(stat.size > 0 && stat.is_dir === false && stat.size < 1000000){
            let profile_json = await puter.fs.read('/' + username + '/Public/.profile');
            profile_json = await blob2str(profile_json);
            const profile = JSON.parse(profile_json);

            if(profile.picture && profile.picture.startsWith('data:image')){
                icon = profile.picture;
            }
        }
    }catch(e){
    }

    return icon;
}

window.format_with_units = (num, { mulUnits, divUnits, precision = 3 }) => {
  if ( num === 0 ) return "0";

  const mulUnits = ["", "K", "M", "G", "T", "P", "E", "Z", "Y"];
  const divUnits = ["m", "µ", "n", "p", "f", "a", "z", "y"];

  const abs = Math.abs(num);
  let exp = Math.floor(Math.log10(abs) / 3);
  let symbol = "";

  symbol = exp >= 0
    ? mulUnits[exp]
    : divUnits[-exp - 1] ;

  if ( ! symbol ) {
    symbol = `e${exp * 3}`;
  }

  const scaled = num / Math.pow(10, exp * 3);
  const rounded = Number.parseFloat(scaled.toPrecision(precision));

  return `${rounded}${symbol}`;
};

window.format_SI = (num) => {
  if ( num === 0 ) return "0";

  const mulUnits = ["", "K", "M", "G", "T", "P", "E", "Z", "Y"];
  const divUnits = ["m", "µ", "n", "p", "f", "a", "z", "y"];
  
  return window.format_with_units(num, { mulUnits, divUnits });
};

window.format_credits = (num) => {
  if ( num === 0 ) return "0";
  
  const mulUnits = ["", "K", "M", "B", "T", "Q"];

  return window.format_with_units(num, { mulUnits })
};
