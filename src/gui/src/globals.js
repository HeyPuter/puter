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

window.clipboard_op = '';
window.clipboard = [];
window.actions_history = [];
window.window_nav_history = {};
window.window_nav_history_current_position = {};
window.progress_tracker = [];
window.upload_item_global_id = 0;
window.app_instance_ids = new Set();

window.menubars = [];
window.download_progress = [];
window.download_item_global_id = 0;

// This is the minimum width of the window for the sidebar to be shown
window.window_width_threshold_for_sidebar = 500;

// the window over which mouse is hovering
window.mouseover_window = null;

// an active itewm container is the one where keyboard events should work (arrow keys, ...)
window.active_item_container = null;

window.mouseX = 0;
window.mouseY = 0;

// get all logged-in users
try{
    window.logged_in_users = JSON.parse(localStorage.getItem("logged_in_users"));
}catch(e){
    window.logged_in_users = [];
}
if(window.logged_in_users === null)
    window.logged_in_users = [];

// this sessions's user
window.auth_token = localStorage.getItem("auth_token");
try{
    window.user = JSON.parse(localStorage.getItem("user"));
}catch(e){
    window.user = null;
}

// in case this is the first time user is visiting multi-user feature
if(window.logged_in_users.length === 0 && window.user !== null){
    let tuser = window.user;
    tuser.auth_token = window.auth_token
    window.logged_in_users.push(tuser);
    localStorage.setItem("logged_in_users", window.logged_in_users);
}

window.last_window_zindex = 1;

// first visit tracker
window.first_visit_ever = localStorage.getItem("has_visited_before") === null ? true : false;
localStorage.setItem("has_visited_before", true);

// system paths
if(window.user !== undefined && window.user !== null){
    window.desktop_path = '/' + window.user.username + '/Desktop';
    window.trash_path = '/' + window.user.username + '/Trash';
    window.appdata_path = '/' + window.user.username + '/AppData';
    window.documents_path = '/' + window.user.username + '/Documents';
    window.pictures_path = '/' + window.user.username + '/Photos';
    window.videos_path = '/' + window.user.username + '/Videos';
    window.audio_path = '/' + window.user.username + '/Audio';
    window.public_path = '/' + window.user.username + '/Public';
    window.home_path = '/' + window.user.username;
}
window.root_dirname = 'Puter';

// user preferences, persisted across sessions, cached in localStorage
try {
    window.user_preferences = JSON.parse(localStorage.getItem('user_preferences'))
}catch(e){
    window.user_preferences = null;
}
// default values
if (window.user_preferences === null) {
    window.user_preferences = {
        show_hidden_files: false,
        language: navigator.language.split("-")[0] || navigator.userLanguage || 'en',
        clock_visible: 'auto',
    }
}

window.window_stack = []
window.toolbar_height = 0;
window.default_taskbar_height = 50;
window.taskbar_height = window.default_taskbar_height;
window.upload_progress_hide_delay = 500;
window.active_uploads = {};
window.copy_progress_hide_delay = 1000;
window.zip_progress_hide_delay = 2000;
window.unzip_progress_hide_delay = 2000;
window.busy_indicator_hide_delay = 600;
window.global_element_id = 0;
window.operation_id = 0;
window.operation_cancelled = [];
window.last_enter_pressed_to_rename_ts = 0;
window.window_counter = 0;
window.keypress_item_seach_term = '';
window.keypress_item_seach_buffer_timeout = undefined;
window.first_visit_animation = false;
window.show_twitter_link = true;
window.animate_window_opening = true;
window.animate_window_closing = true;
window.desktop_loading_fade_delay = (window.first_visit_ever && window.first_visit_animation ? 6000 : 1000);
window.watchItems = [];
window.appdata_signatures = {};
window.appCallbackFunctions = [];

// Defines how much weight each operation has in the zipping progress
window.zippingProgressConfig = {
    TOTAL: 100
}
//Assuming uInt8Array conversion a file takes betwneen 45% to 60% of the total progress
window.zippingProgressConfig.SEQUENCING = Math.floor(Math.random() * (60 - 45 + 1)) + 45,
//Assuming zipping up uInt8Arrays takes betwneen 20% to 23% of the total progress
window.zippingProgressConfig.ZIPPING = Math.floor(Math.random() * (23 - 20 + 1)) + 20,
//Assuming writing a zip file takes betwneen 10% to 14% of the total progress
window.zippingProgressConfig.WRITING = Math.floor(Math.random() * (14 - 10 + 1)) + 14,

// 'Launch' apps
window.launch_apps = [];
window.launch_apps.recent = []
window.launch_apps.recommended = []

// Map of { child_instance_id -> { parent_instance_id, launch_msg_id } }
window.child_launch_callbacks = {};

// Is puter being loaded inside an iframe?
if (window.location !== window.parent.location) {
    window.is_embedded = true;
    // taskbar is not needed in embedded mode
    window.taskbar_height = 0;
} else {
    window.is_embedded = false;
}

// calculate desktop height and width
window.desktop_height = window.innerHeight - window.toolbar_height - window.taskbar_height;
window.desktop_width = window.innerWidth;

// {id: {left: 0, top: 0}}
window.original_window_position = {};
window.a_window_is_resizing = false;
window.a_window_sidebar_is_resizing = false;

// recalculate desktop height and width on window resize
$( window ).on( "resize", function() {
    if(window.is_fullpage_mode) return;
    if(window.a_window_is_resizing) return;
    if(window.a_window_sidebar_is_resizing) return;

    const new_desktop_height = window.innerHeight - window.toolbar_height - window.taskbar_height;
    const new_desktop_width = window.innerWidth;

    window.desktop_height = new_desktop_height;
    window.desktop_width = new_desktop_width;
});
  
// for now `active_element` is basically the last element that was clicked,
// later on though (todo) `active_element` will also be set by keyboard movements 
// such as arrow keys, tab key, ... and when creating new windows...
window.active_element = null;

// The number of recent apps to show in the launch menu
window.launch_recent_apps_count = 10;

// indicated if the mouse is in one of the window snap zones or not
// if yes, which one?
window.current_active_snap_zone = undefined;

// 
window.is_fullpage_mode = false;

window.window_border_radius = 4;

window.sites = [];

window.feature_flags = {
    // if true, the user will be able to create shortcuts to files and directories
    create_shortcut: true,
    // if true, the user will be asked to confirm before navigating away from Puter only if there is at least one window open
    prompt_user_when_navigation_away_from_puter: false,
    // if true, the user will be able to zip and download directories
    download_directory: true,
}

// whitelisted users for AI app
window.ai_app_whitelisted_users = ['admin', 'nj', 'salazareos'];

window.is_auto_arrange_enabled = true;
window.desktop_item_positions = {};
window.reset_item_positions = true; // The variable decides if the item positions should be reset when the user enabled auto arrange

window.file_templates = []

// default language
window.locale = 'en';

// the transaction class
window.Transaction = class {
    constructor(name) {
        this.name = name;
        this.id = uuidv4();
    }

    start() {
        this.start_ts = Date.now();
    }

    getDuration() {
        return Date.now() - this.start_ts;
    }

    end() {
        this.end_ts = Date.now();
        this.duration = this.end_ts - this.start_ts;

        // emit an event
        window.dispatchEvent(new CustomEvent('transaction-ended', {
            detail: {
                transaction: this
            }
        }));
    }
}