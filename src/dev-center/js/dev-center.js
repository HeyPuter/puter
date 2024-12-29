/**
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

let URLParams = new URLSearchParams(window.location.search);
let domain = 'puter.com', authUsername;
let source_path
let apps = [];
let sortBy = 'created_at';
let sortDirection = 'desc';
const dev_center_uid = puter.appID;
let developer;
let activeTab = 'apps';
let currently_editing_app;
let dropped_items;
let search_query;
let originalValues = {};

const APP_CATEGORIES = [
    { id: 'games', label: 'Games' },
    { id: 'developer-tools', label: 'Developer Tools' },
    { id: 'photo-video', label: 'Photo & Video' },
    { id: 'productivity', label: 'Productivity' },
    { id: 'utilities', label: 'Utilities' },
    { id: 'education', label: 'Education' },
    { id: 'business', label: 'Business' },
    { id: 'social', label: 'Social' },
    { id: 'graphics-design', label: 'Graphics & Design' },
    { id: 'music-audio', label: 'Music & Audio' },
    { id: 'news', label: 'News' },
    { id: 'entertainment', label: 'Entertainment' },
    { id: 'finance', label: 'Finance' },
    { id: 'health-fitness', label: 'Health & Fitness' },
    { id: 'lifestyle', label: 'Lifestyle' },
];

const deploying_spinner = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner_P7sC{transform-origin:center;animation:spinner_svv2 .75s infinite linear}@keyframes spinner_svv2{100%{transform:rotate(360deg)}}</style><path d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" class="spinner_P7sC"/></svg>`;
const loading_spinner = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner_P7sC{transform-origin:center;animation:spinner_svv2 .75s infinite linear}@keyframes spinner_svv2{100%{transform:rotate(360deg)}}</style><path d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" class="spinner_P7sC"/></svg>`;
const drop_area_placeholder = `<p>Drop your app folder and files here to deploy.</p><p style="font-size: 16px; margin-top: 0px;">HTML, JS, CSS, ...</p>`;
const index_missing_error = `Please upload an 'index.html' file or if you're uploading a directory, make sure it contains an 'index.html' file at its root.`;
const lock_svg = '<svg style="width: 20px; height: 20px; margin-bottom: -5px; margin-left: 5px; opacity: 0.5;" width="59px" height="59px" stroke-width="1.9" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000"><path d="M16 12H17.4C17.7314 12 18 12.2686 18 12.6V19.4C18 19.7314 17.7314 20 17.4 20H6.6C6.26863 20 6 19.7314 6 19.4V12.6C6 12.2686 6.26863 12 6.6 12H8M16 12V8C16 6.66667 15.2 4 12 4C8.8 4 8 6.66667 8 8V12M16 12H8" stroke="#000000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
const copy_svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-copy" viewBox="0 0 16 16"> <path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/> </svg>`;

// authUsername
(async () => {
    let user = await puter.auth.getUser();

    if (user?.username) {
        authUsername = user.username;
    }
})()

// source_path
if (URLParams.has('source_path')) {
    source_path = URLParams.get('source_path');
} else {
    source_path = null;
}

// domain and APIOrigin
if (URLParams.has('puter.domain')) {
    domain = URLParams.get('puter.domain')
}

// static hosting domain
let static_hosting_domain = 'puter.site';
if(domain === 'puter.localhost'){
    static_hosting_domain = 'site.puter.localhost';
}

// add port to static_hosting_domain if provided
if (URLParams.has('puter.port') && URLParams.get('puter.port')) {
    static_hosting_domain = static_hosting_domain + `:` + html_encode(URLParams.get('puter.port'));
}

// protocol
let protocol = 'https';
if (URLParams.has('puter.protocol') && URLParams.get('puter.protocol') === 'http')
    protocol = 'http';

// port
let port = '';
if (URLParams.has('puter.port') && URLParams.get('puter.port')) {
    port = html_encode(URLParams.get('puter.port'));
}

$(document).ready(function () {
    // initialize assets directory
    initializeAssetsDirectory();

    $('#loading').show();

    setTimeout(async function () {
        puter.ui.onLaunchedWithItems(async function (items) {
            source_path = items[0].path;
            // if source_path is provided, this means that the user is creating a new app/updating an existing app
            // by deploying an existing Puter folder. So we create the app and deploy it.
            if (source_path) {
                // todo if there are no apps, go straight to creating a new app
                $('.insta-deploy-modal').get(0).showModal();
                // set item name
                $('.insta-deploy-item-name').html(html_encode(items[0].name));
            }
        })

        // Get dev profile. This is only for puter.com for now as we don't have dev profiles in self-hosted Puter
        if(domain === 'puter.com'){
            puter.apps.getDeveloperProfile(async function (dev_profile) {
                developer = dev_profile;
                if (dev_profile.approved_for_incentive_program && !dev_profile.joined_incentive_program) {
                    $('#join-incentive-program').show();
                }

                // show earn money c2a only if dev is not approved for incentive program or has already joined
                if (!dev_profile.approved_for_incentive_program || dev_profile.joined_incentive_program) {
                    puter.kv.get('earn-money-c2a-closed').then((value) => {
                        if (value?.result || value === true || value === "true")
                            return;

                        $('#earn-money').get(0).showModal();
                    });
                }

                // show payout method tab if dev has joined incentive program
                if (dev_profile.joined_incentive_program) {
                    $('.tab-btn[data-tab="payout-method"]').show();
                    $('#payout-method-email').html(dev_profile.paypal);
                }
            })
        }
        // Get apps
        puter.apps.list({ icon_size: 64 }).then((resp) => {
            apps = resp;

            // hide loading
            $('#loading').hide();

            // set apps
            if (apps.length > 0) {
                if (activeTab === 'apps') {
                    $('#no-apps-notice').hide();
                    $('#app-list').show();
                }
                $('.app-card').remove();
                apps.forEach(app => {
                    $('#app-list-table > tbody').append(generate_app_card(app));
                });
                count_apps();
                sort_apps();
            } else {
                $('#no-apps-notice').show();
            }
        })
    }, 1000);
});

/**
 * Refreshes the list of apps in the UI.
 * 
 * @param {boolean} [show_loading=false] - Whether to show a loading indicator while refreshing.
 * 
 */

function refresh_app_list(show_loading = false) {
    if (show_loading)
        $('#loading').show();
    // get apps
    setTimeout(function () {
        // uncheck the select all checkbox
        $('.select-all-apps').prop('checked', false);

        puter.apps.list({ icon_size: 64 }).then((apps_res) => {
            $('#loading').hide();
            apps = apps_res;
            if (apps.length > 0) {
                if (activeTab === 'apps') {
                    $('#no-apps-notice').hide();
                    $('#app-list').show();
                }
                $('.app-card').remove();
                apps.forEach(app => {
                    $('#app-list-table > tbody').append(generate_app_card(app));
                });
                count_apps();
                sort_apps();
            } else {
                $('#no-apps-notice').show();
                $('#app-list').hide()
            }
        })
    }, show_loading ? 1000 : 0);
}

$(document).on('click', '.tab-btn', function (e) {
    $('section:not(.sidebar)').hide();
    $('.tab-btn').removeClass('active');
    $(this).addClass('active');
    $('section[data-tab="' + $(this).attr('data-tab') + '"]').show();

    // ---------------------------------------------------------------
    // Apps tab
    // ---------------------------------------------------------------
    if ($(this).attr('data-tab') === 'apps') {
        refresh_app_list();
        activeTab = 'apps';
    }
    // ---------------------------------------------------------------
    // Payout Method tab
    // ---------------------------------------------------------------
    else if ($(this).attr('data-tab') === 'payout-method') {
        activeTab = 'payout-method';
        $('#loading').show();
        setTimeout(function () {
            puter.apps.getDeveloperProfile(function (dev_profile) {
                // show payout method tab if dev has joined incentive program
                if (dev_profile.joined_incentive_program) {
                    $('#payout-method-email').html(dev_profile.paypal);
                }
                $('#loading').hide();
                if (activeTab === 'payout-method')
                    $('#tab-payout-method').show();
            })
        }, 1000);
    }
})

$(document).on('click', '.create-an-app-btn', async function (e) {
    let title = await puter.ui.prompt('Please enter a title for your app:', 'My Awesome App');

    if (title.length > 60) {
        puter.ui.alert(`Title cannot be longer than 60.`, [
            {
                label: 'Ok',
            },
        ]);
        // todo go back to create an app prompt and prefill the title input with the title the user entered
        return;
    }
    else if (title) {
        create_app(title);
    }
})

async function create_app(title, source_path = null, items = null) {
    // name
    let name = slugify(title, {
        lower: true,
        strict: true,
    });

    // icon
    let icon = await getBase64ImageFromUrl('./img/app.svg');

    // open the 'Creting new app...' modal
    let start_ts = Date.now();
    $('.new-app-modal').get(0).showModal();

    //----------------------------------------------------
    // Create app
    //----------------------------------------------------
    puter.apps.create({
            title: title,
            name: name,
            indexURL: 'https://dev-center.puter.com/coming-soon.html',
            icon: icon,
            description: ' ',
            maximizeOnStart: false,
            background: false,
            dedupeName: true,
            metadata: {
                window_resizable: true,
                credentialless: true,
            },
    
        })
        .then(async (app) => {
            let app_dir;
            // ----------------------------------------------------
            // Create app directory in AppData
            // ----------------------------------------------------
            app_dir = await puter.fs.mkdir(
                `/${authUsername}/AppData/${dev_center_uid}/${app.uid}`,
                { overwrite: true, recursive: true, rename: false }
            );
            // ----------------------------------------------------
            // Create a router for the app with a fresh hostname
            // ----------------------------------------------------
            let subdomain = name + '-' + Math.random().toString(36).substring(2)
            await puter.hosting.create(subdomain, app_dir.path);

            // ----------------------------------------------------
            // Update the app with the new hostname
            // ----------------------------------------------------
            puter.apps.update(app.name, {
                title: title,
                indexURL: source_path ? protocol + `://${subdomain}.` + static_hosting_domain : 'https://dev-center.puter.com/coming-soon.html',
                icon: icon,
                description: ' ',
                maximizeOnStart: false,
                background: false,
            }).then(async (app) => {
                // refresh app list
                puter.apps.list({ icon_size: 64 }).then(async (resp) => {
                    apps = resp;
                    // Close the 'Creting new app...' modal
                    // but make sure it was shown for at least 2 seconds
                    setTimeout(() => {
                        // open edit app section
                        edit_app_section(app.name);
                        // set drop area if source_path was provided or items were dropped
                        if (source_path || items) {
                            $('.drop-area').removeClass('drop-area-hover');
                            $('.drop-area').addClass('drop-area-ready-to-deploy');
                        }
                        $('.new-app-modal').get(0).close();
                        // deploy app if source_path was provided
                        if (source_path) {
                            deploy(app, source_path);
                        } else if (items) {
                            deploy(app, items);
                        }
                    }, (Date.now() - start_ts) > 2000 ? 1 : 2000 - (Date.now() - start_ts));
                })
            }).catch(async (err) => {
                console.log(err);
             })
            // ----------------------------------------------------
            // Create a "shortcut" on the desktop
            // ----------------------------------------------------
            puter.fs.upload(new File([], app.title),
                `/${authUsername}/Desktop`,
                {
                    name: app.title,
                    dedupeName: true,
                    overwrite: false,
                    appUID: app.uid,
                }
            )
        }).catch(async (err) => {
            $('#create-app-error').show();
            $('#create-app-error').html(err.message);
            // scroll to top so that user sees error message
            document.body.scrollTop = document.documentElement.scrollTop = 0;
        })
}


$(document).on('click', '.deploy-btn', function (e) {
    deploy(currently_editing_app, dropped_items);
})

$(document).on('click', '.edit-app, .got-to-edit-app', function (e) {
    const cur_app_name = $(this).attr('data-app-name')
    edit_app_section(cur_app_name);
})

$(document).on('click', '.delete-app', async function (e) {
    let app_uid = $(this).attr('data-app-uid');
    let app_title = $(this).attr('data-app-title');
    let app_name = $(this).attr('data-app-name');

    // get app
    const app_data = await puter.apps.get(app_name, { icon_size: 16 });

    if(app_data.metadata?.locked){
        puter.ui.alert(`<strong>${app_data.title}</strong> is locked and cannot be deleted.`, [
            {
                label: 'Ok',
            },
        ], {
            type: 'warning',
        });
        return;
    }

    // confirm delete
    const alert_resp = await puter.ui.alert(`Are you sure you want to premanently delete <strong>${html_encode(app_title)}</strong>?`,
        [
            {
                label: 'Yes, delete permanently',
                value: 'delete',
                type: 'danger',
            },
            {
                label: 'Cancel'
            },
        ]
    );

    if (alert_resp === 'delete') {
        let init_ts = Date.now();
        $('.deleting-app-modal')?.get(0)?.showModal();
        puter.apps.delete(app_name).then(async (app) => {
                setTimeout(() => {
                    $('.deleting-app-modal')?.get(0)?.close();
                    $(`.app-card[data-uid="${app_uid}"]`).fadeOut(200, function name(params) {
                        $(this).remove();
                        if ($(`.app-card`).length === 0) {
                            $('section:not(.sidebar)').hide();
                            $('#no-apps-notice').show();
                        } else {
                            $('section:not(.sidebar)').hide();
                            $('#app-list').show();
                        }
                        count_apps();
                    });
                },
                    // make sure the modal was shown for at least 2 seconds
                    (Date.now() - init_ts) > 2000 ? 1 : 2000 - (Date.now() - init_ts));

                // get app directory
                puter.fs.stat({
                    path: `/${authUsername}/AppData/${dev_center_uid}/${app_uid}`,
                    returnSubdomains: true,
                }).then(async (stat) => {
                    // delete subdomain associated with the app dir
                    puter.hosting.delete(stat.subdomains[0].subdomain)
                    // delete app directory
                    puter.fs.delete(
                        `/${authUsername}/AppData/${dev_center_uid}/${app_uid}`,
                        { recursive: true }
                    )
                })
            }).catch(async (err) => {
                setTimeout(() => {

                    $('.deleting-app-modal')?.get(0)?.close();
                    puter.ui.alert(err?.message, [
                        {
                            label: 'Ok',
                        },
                    ]);
                },
                    // make sure the modal was shown for at least 2 seconds
                    (Date.now() - init_ts) > 2000 ? 1 : 2000 - (Date.now() - init_ts));
            })
    }
})

// generate app link
function applink(app) {
    return protocol + `://${domain}${ port ? ':' + port : '' }/app/${app.name}`;
}

/**
 * Generates the HTML for the app editing section.
 * 
 * @param {Object} app - The app object containing details of the app to be edited.
 *  * 
 * @returns {string} HTML string for the app editing section.
 * 
 * @description
 * This function creates the HTML for the app editing interface, including:
 * - App icon and title display
 * - Options to open, add to desktop, or delete the app
 * - Tabs for deployment and settings
 * - Form fields for editing various app properties
 * - Display of app statistics
 * 
 * The generated HTML includes interactive elements and placeholders for 
 * dynamic content to be filled or updated by other functions.
 * 
 * @example
 * const appEditHTML = generate_edit_app_section(myAppObject);
 * $('#edit-app').html(appEditHTML);
 */

function generate_edit_app_section(app) {
    if(app.result)
        app = app.result;

    let maximize_on_start = app.maximize_on_start ? 'checked' : '';

    let h = ``;
    h += `
        <div class="edit-app-navbar">
            <div style="flex-grow:1;">
                <img class="app-icon" data-uid="${html_encode(app.uid)}" src="${html_encode(!app.icon ? './img/app.svg' : app.icon)}">
                <h3 class="app-title" data-uid="${html_encode(app.uid)}">${html_encode(app.title)}${app.metadata?.locked ? lock_svg : ''}</h3>
                <div style="margin-top: 4px; margin-bottom: 4px;">
                    <span class="open-app-btn" data-app-uid="${html_encode(app.uid)}" data-app-name="${html_encode(app.name)}">Open</span>
                    <span style="margin: 5px; opacity: 0.3;">&bull;</span>
                    <span class="add-app-to-desktop" data-app-uid="${html_encode(app.uid)}" data-app-title="${html_encode(app.title)}">Add Shortcut to Desktop</span>
                    <span style="margin: 5px; opacity: 0.3;">&bull;</span>
                    <span title="Delete app" class="delete-app-settings" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(app.title)}" data-app-uid="${html_encode(app.uid)}">Delete</span>
                </div>
                <a class="app-url" target="_blank" data-uid="${html_encode(app.uid)}" href="${html_encode(applink(app))}">${html_encode(applink(app))}</a>
            </div>
            <button class="back-to-main-btn button button-default">Back</button>
        </div>

        <ul class="section-tab-buttons disable-user-select">
            <li class="section-tab-btn active" data-tab="deploy"><span>Deploy</span></li>
            <li class="section-tab-btn" data-tab="info"><span>Settings</span></li>
            <li class="section-tab-btn" data-tab="analytics"><span>Analytics</span></li>
        </ul>

        <div class="section-tab active" data-tab="deploy">
            <div class="success deploy-success-msg">
                New version deployed successfully 🎉<span class="close-success-msg">&times;</span>
                <p style="margin-bottom:0;"><span class="open-app button button-action" data-uid="${html_encode(app.uid)}" data-app-name="${html_encode(app.name)}">Give it a try!</span></p>
            </div>
            <div class="drop-area disable-user-select">${drop_area_placeholder}</div>
            <button class="deploy-btn disable-user-select button button-primary disabled">Deploy Now</button>
        </div>

        <div class="section-tab" data-tab="info">
            <form style="clear:both; padding-bottom: 50px;">
                <div class="error" id="edit-app-error"></div>
                <div class="success" id="edit-app-success">App has been successfully updated.<span class="close-success-msg">&times;</span>
                <p style="margin-bottom:0;"><span class="open-app button button-action" data-uid="${html_encode(app.uid)}" data-app-name="${html_encode(app.name)}">Give it a try!</span></p>
                </div>
                <input type="hidden" id="edit-app-uid" value="${html_encode(app.uid)}">

                <h3 style="font-size: 23px; border-bottom: 1px solid #EEE; margin-top: 40px;">Basic</h3>
                <label for="edit-app-title">Title</label>
                <input type="text" id="edit-app-title" placeholder="My Awesome App!" value="${html_encode(app.title)}">

                <label for="edit-app-name">Name</label>
                <input type="text" id="edit-app-name" placeholder="my-awesome-app" style="font-family: monospace;" value="${html_encode(app.name)}">

                <label for="edit-app-index-url">Index URL</label>
                <input type="text" id="edit-app-index-url" placeholder="https://example-app.com/index.html" value="${html_encode(app.index_url)}">
                
                <label for="edit-app-app-id">App ID</label>
                <div style="overflow:hidden;">
                    <input type="text" style="width: 362px; float:left;" class="app-uid" value="${html_encode(app.uid)}" readonly><span class="copy-app-uid" style="cursor: pointer; height: 35px; display: inline-block; width: 50px; text-align: center; line-height: 35px; margin-left:5px;">${copy_svg}</span>
                </div>

                <label for="edit-app-icon">Icon</label>
                <div id="edit-app-icon" style="background-image:url(${!app.icon ? './img/app.svg' : html_encode(app.icon)});" ${app.icon ? 'data-url="' + html_encode(app.icon) + '"' : ''}  ${app.icon ? 'data-base64="' + html_encode(app.icon) + '"' : ''} >
                    <div id="change-app-icon">Change App Icon</div>
                </div>
                <span id="edit-app-icon-delete" style="${app.icon ? 'display:block;' : ''}">Remove icon</span>

                ${generateSocialImageSection(app)}
                <label for="edit-app-description">Description</label>
                <textarea id="edit-app-description">${html_encode(app.description)}</textarea>
                
                <label for="edit-app-category">Category</label>
                <select id="edit-app-category" class="category-select">
                    <option value="">Select a category</option>
                    ${APP_CATEGORIES.map(category => 
                        `<option value="${html_encode(category.id)}" ${app.metadata?.category === category.id ? 'selected' : ''}>${html_encode(category.label)}</option>`
                    ).join('')}
                </select>

                <label for="edit-app-filetype-associations">File Associations</label>
               <p style="margin-top: 10px; font-size:13px;">A list of file type specifiers. For example if you include <code>.txt</code> your apps could be opened when a user clicks on a TXT file.</p>
               <textarea id="edit-app-filetype-associations"  placeholder=".txt  .jpg    application/json">${JSON.stringify(app.filetype_associations.map(item => ({ "value": item })), null, app.filetype_associations.length)}</textarea>

                <h3 style="font-size: 23px; border-bottom: 1px solid #EEE; margin-top: 50px; margin-bottom: 0px;">Window</h3>
                <div>
                    <input type="checkbox" id="edit-app-background" name="edit-app-background" value="true" style="margin-top:30px;" ${app.background ? 'checked' : ''}>
                    <label for="edit-app-background" style="display: inline;">Run as a background process.</label>
                </div>

                <div>
                    <input type="checkbox" id="edit-app-fullpage-on-landing" name="edit-app-fullpage-on-landing" value="true" style="margin-top:30px;" ${app.metadata?.fullpage_on_landing ? 'checked' : ''} ${app.background ? 'disabled' : ''}>
                    <label for="edit-app-fullpage-on-landing" style="display: inline;">Load in full-page mode when a user lands directly on this app.</label>
                </div>

                <div>
                    <input type="checkbox" id="edit-app-maximize-on-start" name="edit-app-maximize-on-start" value="true" style="margin-top:30px;" ${maximize_on_start ? 'checked' : ''} ${app.background ? 'disabled' : ''}>
                    <label for="edit-app-maximize-on-start" style="display: inline;">Maximize window on start</label>
                </div>
                
                <div>
                    <label for="edit-app-window-width">Initial window width</label>
                    <input type="number" id="edit-app-window-width" placeholder="680" value="${html_encode(app.metadata?.window_size?.width ?? 680)}" style="width:200px;" ${maximize_on_start || app.background ? 'disabled' : ''}>
                    <label for="edit-app-window-height">Initial window height</label>
                    <input type="number" id="edit-app-window-height" placeholder="380" value="${html_encode(app.metadata?.window_size?.height ?? 380)}" style="width:200px;" ${maximize_on_start || app.background ? 'disabled' : ''}>
                </div>

                <div style="margin-top:30px;">
                    <label for="edit-app-window-top">Initial window top</label>
                    <input type="number" id="edit-app-window-top" placeholder="100" value="${app.metadata?.window_position?.top ? html_encode(app.metadata.window_position.top) : ''}" style="width:200px;" ${maximize_on_start || app.background ? 'disabled' : ''}>
                    <label for="edit-app-window-left">Initial window left</label>
                    <input type="number" id="edit-app-window-left" placeholder="100" value="${app.metadata?.window_position?.left ? html_encode(app.metadata.window_position.left) : ''}" style="width:200px;" ${maximize_on_start || app.background ? 'disabled' : ''}>
                </div>

                <div style="margin-top:30px;">
                    <input type="checkbox" id="edit-app-window-resizable" name="edit-app-window-resizable" value="true" ${app.metadata?.window_resizable ? 'checked' : ''} ${app.background ? 'disabled' : ''}>
                    <label for="edit-app-window-resizable" style="display: inline;">Resizable window</label>
                </div>

                <div style="margin-top:30px;">
                    <input type="checkbox" id="edit-app-hide-titlebar" name="edit-app-hide-titlebar" value="true" ${app.metadata?.hide_titlebar ? 'checked' : ''} ${app.background ? 'disabled' : ''}>
                    <label for="edit-app-hide-titlebar" style="display: inline;">Hide window titlebar</label>
                </div>

                <h3 style="font-size: 23px; border-bottom: 1px solid #EEE; margin-top: 50px; margin-bottom: 0px;">Misc</h3>
                <div style="margin-top:30px;">
                    <input type="checkbox" id="edit-app-locked" name="edit-app-locked" value="true" ${app.metadata?.locked ? 'checked' : ''}>
                    <label for="edit-app-locked" style="display: inline;">Locked</label>
                    <p>When locked, the app cannot be deleted. This is useful to prevent accidental deletion of important apps.</p>
                </div>

                <h3 style="font-size: 23px; border-bottom: 1px solid #EEE; margin-top: 50px; margin-bottom: 0px;">Advanced</h3>
                <div style="margin-top:30px;">
                    <input type="checkbox" id="edit-app-credentialless" name="edit-app-credentialless" value="true" ${(app.metadata?.credentialless === true || app.metadata === undefined || app.metadata?.credentialless === undefined) ? 'checked' : ''}>
                    <label for="edit-app-credentialless" style="display: inline;">Credentialless</label>
                    <p><code>credentialless</code> attribute for the <code>iframe</code> tag.</p>
                </div>

                <div style="z-index: 999; box-shadow: 10px 10px 15px #8c8c8c; overflow: hidden; position: fixed; bottom: 0; background: white; padding: 10px; width: 100%; left: 0;">
                    <button type="button" class="edit-app-save-btn button button-primary" style="margin-right: 40px;">Save</button>
                    <button type="button" class="edit-app-reset-btn button button-secondary">Reset</button>
                </div>
            </form>
        </div>
        <div class="section-tab" data-tab="analytics">
            <label for="analytics-period">Period</label>
            <select id="analytics-period" class="category-select">
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <optgroup label="──────"></optgroup>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <optgroup label="──────"></optgroup>
                <option value="this_month">This month</option>
                <option value="last_month">Last month</option>
                <optgroup label="──────"></optgroup>
                <option value="this_year">This year</option>
                <option value="last_year">Last year</option>
                <optgroup label="──────"></optgroup>
                <option value="12m">Last 12 months</option>
                <option value="all">All time</option>
            </select>
            <div style="overflow:hidden;">
                <div class="analytics-card" id="analytics-users">
                    <h3 style="margin-top:0;">Users</h3>
                    <div class="count" style="font-size: 35px;"></div>
                </div>
                <div class="analytics-card" id="analytics-opens">
                    <h3 style="margin-top:0;">Opens</h3>
                    <div class="count" style="font-size: 35px;"></div>
                </div>
            </div>
            <hr style="margin-top: 50px;">
            <p>Timezone: UTC</p>
            <p>More analytics features coming soon...</p>
        </div>
    `
    return h;
}

/* This function keeps track of the original values of the app before it is edited*/ 
function trackOriginalValues(){
    originalValues = {
        title: $('#edit-app-title').val(),
        name: $('#edit-app-name').val(),
        indexURL: $('#edit-app-index-url').val(),
        description: $('#edit-app-description').val(),
        icon: $('#edit-app-icon').attr('data-base64'),
        fileAssociations: $('#edit-app-filetype-associations').val(),
        category: $('#edit-app-category').val(),
        socialImage: $('#edit-app-social-image').attr('data-base64'),
        windowSettings: {
            width: $('#edit-app-window-width').val(),
            height: $('#edit-app-window-height').val(),
            top: $('#edit-app-window-top').val(),
            left: $('#edit-app-window-left').val()
        },
        checkboxes: {
            maximizeOnStart: $('#edit-app-maximize-on-start').is(':checked'),
            background: $('#edit-app-background').is(':checked'),
            resizableWindow: $('#edit-app-window-resizable').is(':checked'),
            hideTitleBar: $('#edit-app-hide-titlebar').is(':checked'),
            locked: $('#edit-app-locked').is(':checked'),
            credentialless: $('#edit-app-credentialless').is(':checked'),
            fullPageOnLanding: $('#edit-app-fullpage-on-landing').is(':checked')
        }
    };
}

/* This function compares for all fields and checks if anything has changed from before editting*/
function hasChanges() {
    // is icon changed
    if($('#edit-app-icon').attr('data-base64') !== originalValues.icon){
        return true;
    }

    // if social image is changed
    if($('#edit-app-social-image').attr('data-base64') !== originalValues.socialImage){
        return true;
    }

    // if any of the fields have changed
    return(
        $('#edit-app-title').val() !== originalValues.title ||
        $('#edit-app-name').val() !== originalValues.name ||
        $('#edit-app-index-url').val() !== originalValues.indexURL ||
        $('#edit-app-description').val() !== originalValues.description ||
        $('#edit-app-icon').attr('data-base64') !== originalValues.icon ||
        $('#edit-app-filetype-associations').val() !== originalValues.fileAssociations ||
        $('#edit-app-category').val() !== originalValues.category ||
        $('#edit-app-social-image').attr('data-base64') !== originalValues.socialImage ||
        $('#edit-app-window-width').val() !== originalValues.windowSettings.width ||
        $('#edit-app-window-height').val() !== originalValues.windowSettings.height ||
        $('#edit-app-window-top').val() !== originalValues.windowSettings.top ||
        $('#edit-app-window-left').val() !== originalValues.windowSettings.left ||
        $('#edit-app-maximize-on-start').is(':checked') !== originalValues.checkboxes.maximizeOnStart ||
        $('#edit-app-background').is(':checked') !== originalValues.checkboxes.background ||
        $('#edit-app-window-resizable').is(':checked') !== originalValues.checkboxes.resizableWindow ||
        $('#edit-app-hide-titlebar').is(':checked') !== originalValues.checkboxes.hideTitleBar ||
        $('#edit-app-locked').is(':checked') !== originalValues.checkboxes.locked ||
        $('#edit-app-credentialless').is(':checked') !== originalValues.checkboxes.credentialless ||
        $('#edit-app-fullpage-on-landing').is(':checked') !== originalValues.checkboxes.fullPageOnLanding
    );
}

/* This function enables or disables the save button if there are any changes made */
function toggleSaveButton() {
    if (hasChanges()) {
        $('.edit-app-save-btn').prop('disabled', false);
    } else {
        $('.edit-app-save-btn').prop('disabled', true);
    }
}

/* This function enables or disables the reset button if there are any changes made */
function toggleResetButton() {
    if (hasChanges()) {
        $('.edit-app-reset-btn').prop('disabled', false);
    } else {
        $('.edit-app-reset-btn').prop('disabled', true);
    }
}

/* This function revers the changes made back to the original values of the edit form */
function resetToOriginalValues() {
    $('#edit-app-title').val(originalValues.title);
    $('#edit-app-name').val(originalValues.name);
    $('#edit-app-index-url').val(originalValues.indexURL);
    $('#edit-app-description').val(originalValues.description);
    $('#edit-app-filetype-associations').val(originalValues.fileAssociations);
    $('#edit-app-category').val(originalValues.category);
    $('#edit-app-window-width').val(originalValues.windowSettings.width);
    $('#edit-app-window-height').val(originalValues.windowSettings.height);
    $('#edit-app-window-top').val(originalValues.windowSettings.top);
    $('#edit-app-window-left').val(originalValues.windowSettings.left);
    $('#edit-app-maximize-on-start').prop('checked', originalValues.checkboxes.maximizeOnStart);
    $('#edit-app-background').prop('checked', originalValues.checkboxes.background);
    $('#edit-app-window-resizable').prop('checked', originalValues.checkboxes.resizableWindow);
    $('#edit-app-hide-titlebar').prop('checked', originalValues.checkboxes.hideTitleBar);
    $('#edit-app-locked').prop('checked', originalValues.checkboxes.locked);
    $('#edit-app-credentialless').prop('checked', originalValues.checkboxes.credentialless);
    $('#edit-app-fullpage-on-landing').prop('checked', originalValues.checkboxes.fullPageOnLanding);

    if (originalValues.icon) {
        $('#edit-app-icon').css('background-image', `url(${originalValues.icon})`);
        $('#edit-app-icon').attr('data-url', originalValues.icon);
        $('#edit-app-icon').attr('data-base64', originalValues.icon);
        $('#edit-app-icon-delete').show();
    } else {
        $('#edit-app-icon').css('background-image', '');
        $('#edit-app-icon').removeAttr('data-url');
        $('#edit-app-icon').removeAttr('data-base64');
        $('#edit-app-icon-delete').hide();
    }

    if (originalValues.socialImage) {
        $('#edit-app-social-image').css('background-image', `url(${originalValues.socialImage})`);
        $('#edit-app-social-image').attr('data-url', originalValues.socialImage);
        $('#edit-app-social-image').attr('data-base64', originalValues.socialImage);
    } else {
        $('#edit-app-social-image').css('background-image', '');
        $('#edit-app-social-image').removeAttr('data-url');
        $('#edit-app-social-image').removeAttr('data-base64');
    }
}

async function edit_app_section(cur_app_name) {
    $('section:not(.sidebar)').hide();
    $('.tab-btn').removeClass('active');
    $('.tab-btn[data-tab="apps"]').addClass('active');

    let cur_app = await puter.apps.get(cur_app_name, {icon_size: 128, stats_period: 'today'});
    
    currently_editing_app = cur_app;

    // generate edit app section
    $('#edit-app').html(generate_edit_app_section(cur_app));
    trackOriginalValues();  // Track initial field values
    toggleSaveButton();  // Ensure Save button is initially disabled
    toggleResetButton();  // Ensure Reset button is initially disabled
    $('#edit-app').show();

    // analytics
    $('#analytics-users .count').html(cur_app.stats.user_count);
    $('#analytics-opens .count').html(cur_app.stats.open_count);
    
    // get analytics
    const filetype_association_input = document.querySelector('textarea[id=edit-app-filetype-associations]');
    let tagify = new Tagify(filetype_association_input, {
        pattern: /\.(?:[a-z0-9]+)|(?:[a-z]+\/(?:[a-z0-9.-]+|\*))/,
        delimiters: ", ",
        enforceWhitelist: false,
        dropdown : {
            // show the dropdown immediately on focus (0 character typed)
            enabled: 0,
        },
        whitelist: [
          // MIME type patterns
          "text/*", "image/*", "audio/*", "video/*", "application/*",
          
          // Documents
          ".doc", ".docx", ".pdf", ".txt", ".odt", ".rtf", ".tex", ".md", ".pages", ".epub", ".mobi", ".azw", ".azw3", ".djvu", ".xps", ".oxps", ".fb2", ".textile", ".markdown", ".asciidoc", ".rst", ".wpd", ".wps", ".abw", ".zabw",
          
          // Spreadsheets
          ".xls", ".xlsx", ".csv", ".ods", ".numbers", ".tsv", ".gnumeric", ".xlt", ".xltx", ".xlsm", ".xltm", ".xlam", ".xlsb",
          
          // Presentations
          ".ppt", ".pptx", ".key", ".odp", ".pps", ".ppsx", ".pptm", ".potx", ".potm", ".ppam",
          
          // Images
          ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".svg", ".webp", ".ico", ".psd", ".ai", ".eps", ".raw", ".cr2", ".nef", ".orf", ".sr2", ".heic", ".heif", ".avif", ".jxr", ".hdp", ".wdp", ".jng", ".xcf", ".pgm", ".pbm", ".ppm", ".pnm",
          
          // Video
          ".mp4", ".avi", ".mov", ".wmv", ".mkv", ".flv", ".webm", ".m4v", ".mpeg", ".mpg", ".3gp", ".3g2", ".ogv", ".vob", ".drc", ".gifv", ".mng", ".qt", ".yuv", ".rm", ".rmvb", ".asf", ".amv", ".m2v", ".svi",
          
          // Audio
          ".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a", ".wma", ".aiff", ".alac", ".ape", ".au", ".mid", ".midi", ".mka", ".pcm", ".ra", ".ram", ".snd", ".wv", ".opus",
          
          // Code/Development
          ".js", ".ts", ".html", ".css", ".json", ".xml", ".php", ".py", ".java", ".cpp", ".c", ".cs", ".h", ".hpp", ".hxx", ".rs", ".go", ".rb", ".pl", ".swift", ".kt", ".kts", ".scala", ".coffee", ".sass", ".scss", ".less", ".jsx", ".tsx", ".vue", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".sql", ".r", ".dart", ".f", ".f90", ".for", ".lua", ".m", ".mm", ".clj", ".erl", ".ex", ".exs", ".elm", ".hs", ".lhs", ".lisp", ".ml", ".mli", ".nim", ".pl", ".rkt", ".v", ".vhd",
          
          // Archives
          ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".z", ".lz", ".lzma", ".tlz", ".txz", ".tgz", ".tbz2", ".bz", ".br", ".lzo", ".ar", ".cpio", ".shar", ".lrz", ".lz4", ".lz2", ".rz", ".sfark", ".sz", ".zoo",
          
          // Database
          ".db", ".sql", ".sqlite", ".sqlite3", ".dbf", ".mdb", ".accdb", ".db3", ".s3db", ".dbx",
          
          // Fonts
          ".ttf", ".otf", ".woff", ".woff2", ".eot", ".pfa", ".pfb", ".sfd",
          
          // CAD and 3D
          ".dwg", ".dxf", ".stl", ".obj", ".fbx", ".dae", ".3ds", ".blend", ".max", ".ma", ".mb", ".c4d", ".skp", ".usd", ".usda", ".usdc", ".abc",
          
          // Scientific/Technical
          ".mat", ".fig", ".nb", ".cdf", ".fits", ".fts", ".fit", ".gmsh", ".msh", ".fem", ".neu", ".hdf", ".h5", ".nx", ".unv",
          
          // System
          ".exe", ".dll", ".so", ".dylib", ".app", ".dmg", ".iso", ".img", ".bin", ".msi", ".apk", ".ipa", ".deb", ".rpm",
          
          // Directory
          ".directory"
        ],
    })

    // --------------------------------------------------------
    // Dragster
    // --------------------------------------------------------
    let drop_area_content = drop_area_placeholder;

    $('.drop-area').dragster({
        enter: function (dragsterEvent, event) {
            drop_area_content = $('.drop-area').html();
            $('.drop-area').addClass('drop-area-hover');
            $('.drop-area').html(drop_area_placeholder);
        },
        leave: function (dragsterEvent, event) {
            $('.drop-area').html(drop_area_content);
            $('.drop-area').removeClass('drop-area-hover');
        },
        drop: async function (dragsterEvent, event) {
            const e = event.originalEvent;
            e.stopPropagation();
            e.preventDefault();

            // hide previous success message
            $('.deploy-success-msg').fadeOut();

            // remove hover class
            $('.drop-area').removeClass('drop-area-hover');

            //----------------------------------------------------
            // Puter items dropped
            //----------------------------------------------------
            if (e.detail?.items?.length > 0) {
                let items = e.detail.items;

                // ----------------------------------------------------
                // One Puter file dropped
                // ----------------------------------------------------
                if (items.length === 1 && !items[0].isDirectory) {
                    if (items[0].name.toLowerCase() === 'index.html') {
                        dropped_items = items[0].path;
                        $('.drop-area').removeClass('drop-area-hover');
                        $('.drop-area').addClass('drop-area-ready-to-deploy');
                        drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">index.html</p><p>Ready to deploy 🚀</p><p class="reset-deploy"><span>Cancel</span></p>`;
                        $('.drop-area').html(drop_area_content);

                        // enable deploy button
                        $('.deploy-btn').removeClass('disabled');

                    } else {
                        puter.ui.alert(`You need to have an index.html file in your deployment.`, [
                            {
                                label: 'Ok',
                            },
                        ]);
                        $('.drop-area').removeClass('drop-area-ready-to-deploy');
                        $('.deploy-btn').addClass('disabled');
                        dropped_items = [];
                    }
                    return;
                }
                // ----------------------------------------------------
                // Multiple Puter files dropped
                // ----------------------------------------------------
                else if (items.length > 1) {
                    let hasIndexHtml = false;
                    for (let item of items) {
                        if (item.name.toLowerCase() === 'index.html') {
                            hasIndexHtml = true;
                            break;
                        }
                    }

                    if (hasIndexHtml) {
                        dropped_items = items;
                        $('.drop-area').removeClass('drop-area-hover');
                        $('.drop-area').addClass('drop-area-ready-to-deploy');
                        drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">${items.length} items</p><p>Ready to deploy 🚀</p><p class="reset-deploy"><span>Cancel</span></p>`;
                        $('.drop-area').html(drop_area_content);

                        // enable deploy button
                        $('.deploy-btn').removeClass('disabled');
                    } else {
                        puter.ui.alert(`You need to have an index.html file in your deployment.`, [
                            {
                                label: 'Ok',
                            },
                        ]);
                        $('.drop-area').removeClass('drop-area-ready-to-deploy');
                        $('.drop-area').removeClass('drop-area-hover');
                        $('.deploy-btn').addClass('disabled');
                        dropped_items = [];
                    }
                    return;
                }
                // ----------------------------------------------------
                // One Puter directory dropped
                // ----------------------------------------------------
                else if (items.length === 1 && items[0].isDirectory) {
                    let children = await puter.fs.readdir(items[0].path);
                    // check if index.html exists, if found, deploy entire directory
                    for (let child of children) {
                        if (child.name === 'index.html') {
                            // deploy(currently_editing_app, items[0].path);
                            dropped_items = items[0].path;
                            let rootItems = '';

                            if (children.length === 1)
                                rootItems = children[0].name;
                            else if (children.length === 2)
                                rootItems = children[0].name + ', ' + children[1].name;
                            else if (children.length === 3)
                                rootItems = children[0].name + ', ' + children[1].name + ', and' + children[1].name;
                            else if (children.length > 3)
                                rootItems = children[0].name + ', ' + children[1].name + ', and ' + (children.length - 2) + ' more item' + (children.length - 2 > 1 ? 's' : '');

                            $('.drop-area').removeClass('drop-area-hover');
                            $('.drop-area').addClass('drop-area-ready-to-deploy');
                            drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">${rootItems}</p><p>Ready to deploy 🚀</p><p class="reset-deploy"><span>Cancel</span></p>`;
                            $('.drop-area').html(drop_area_content);

                            // enable deploy button
                            $('.deploy-btn').removeClass('disabled');
                            return;
                        }
                    }

                    // no index.html in directory
                    puter.ui.alert(index_missing_error, [
                        {
                            label: 'Ok',
                        },
                    ]);
                    $('.drop-area').removeClass('drop-area-ready-to-deploy');
                    $('.deploy-btn').addClass('disabled');
                    dropped_items = [];
                }

                return false;
            }

            //-----------------------------------------------------------------------------
            // Local items dropped
            //-----------------------------------------------------------------------------
            if (!e.dataTransfer || !e.dataTransfer.items || e.dataTransfer.items.length === 0)
                return;

            // get dropped items
            dropped_items = await puter.ui.getEntriesFromDataTransferItems(e.dataTransfer.items);

            // generate a flat array of full paths from the dropped items
            let paths = [];
            for (let item of dropped_items) {
                paths.push('/' + (item.fullPath ?? item.filepath));
            }

            // generate a directory tree from the paths
            let tree = generateDirTree(paths);

            dropped_items = setRootDirTree(tree, dropped_items);

            // alert if no index.html in root
            if (!hasRootIndexHtml(tree)) {
                puter.ui.alert(index_missing_error, [
                    {
                        label: 'Ok',
                    },
                ]);
                $('.drop-area').removeClass('drop-area-ready-to-deploy');
                $('.deploy-btn').addClass('disabled');
                dropped_items = [];
                return;
            }

            // Get all keys (directories and files) in the root
            const rootKeys = Object.keys(tree);

            // generate a list of items in the root in the form of a string (e.g. /index.html, /css/style.css) with maximum of 3 items
            let rootItems = '';

            if (rootKeys.length === 1)
                rootItems = rootKeys[0];
            else if (rootKeys.length === 2)
                rootItems = rootKeys[0] + ', ' + rootKeys[1];
            else if (rootKeys.length === 3)
                rootItems = rootKeys[0] + ', ' + rootKeys[1] + ', and' + rootKeys[1];
            else if (rootKeys.length > 3)
                rootItems = rootKeys[0] + ', ' + rootKeys[1] + ', and ' + (rootKeys.length - 2) + ' more item' + (rootKeys.length - 2 > 1 ? 's' : '');

            rootItems = html_encode(rootItems);
            $('.drop-area').removeClass('drop-area-hover');
            $('.drop-area').addClass('drop-area-ready-to-deploy');
            drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">${rootItems}</p><p>Ready to deploy 🚀</p><p class="reset-deploy"><span>Cancel</span></p>`;
            $('.drop-area').html(drop_area_content);

            // enable deploy button
            $('.deploy-btn').removeClass('disabled');

            return false;
        }
    });

    // Focus on the first input
    $('#edit-app-title').focus();
}

$('.jip-submit-btn').on('click', async function (e) {
    const first_name = $('#jip-first-name').val();
    const last_name = $('#jip-last-name').val();
    const paypal = $('#jip-paypal').val();
    let error;

    if (first_name === '' || last_name === '' || paypal === '')
        error = `All fields are required.`;
    else if (first_name.length > 100)
        error = `<strong>First Name</strong> cannot be longer than ${100}.`;
    else if (last_name.length > 100)
        error = `<strong>Last Name</strong> cannot be longer than ${100}.`;
    else if (paypal.length > 100)
        error = `<strong>Paypal</strong> cannot be longer than ${100}.`;
    // check if email is valid
    else if (!validateEmail(paypal))
        error = `Paypal email must be a valid email address.`;

    // error?
    if (error) {
        $('#jip-error').show();
        $('#jip-error').html(error);
        document.body.scrollTop = document.documentElement.scrollTop = 0;
        return;
    }

    // disable submit button
    $('.jip-submit-btn').prop('disabled', true);

    $.ajax({
        url: puter.APIOrigin + "/jip",
        type: 'POST',
        async: true,
        contentType: "application/json",
        data: JSON.stringify({
            first_name: first_name,
            last_name: last_name,
            paypal: paypal,
        }),
        headers: {
            "Authorization": "Bearer " + puter.authToken
        },
        success: function () {
            $('#jip-success').show();
            $('#jip-form').hide();
            //enable submit button
            $('.jip-submit-btn').prop('disabled', false);
            // update dev profile
            $('#payout-method-email').html(paypal);
            // show payout method tab
            $('.tab-btn[data-tab="payout-method"]').show();
        },
        error: function (err) {
            $('#jip-error').show();
            $('#jip-error').html(err.message);
            // scroll to top so that user sees error message
            document.body.scrollTop = document.documentElement.scrollTop = 0;
            // enable submit button
            $('.jip-submit-btn').prop('disabled', false);
        }
    })
})

$(document).on('click', '.edit-app-save-btn', async function (e) {
    const title = $('#edit-app-title').val();
    const name = $('#edit-app-name').val();
    const index_url = $('#edit-app-index-url').val();
    const description = $('#edit-app-description').val();
    const uid = $('#edit-app-uid').val();
    const height = $('#edit-app-window-height').val();
    const width = $('#edit-app-window-width').val();
    const top = $('#edit-app-window-top').val();
    const left = $('#edit-app-window-left').val();
    const category = $('#edit-app-category').val();

    let filetype_associations = $('#edit-app-filetype-associations').val();

    let icon;

    let error;

    //validation
    if (title === '')
        error = `<strong>Title</strong> is required.`;
    else if (title.length > 60)
        error = `<strong>Title</strong> cannot be longer than ${60}.`;
    else if (name === '')
        error = `<strong>Name</strong> is required.`;
    else if (name.length > 60)
        error = `<strong>Name</strong> cannot be longer than ${60}.`;
    else if (index_url === '')
        error = `<strong>Index URL</strong> is required.`;
    else if (!name.match(/^[a-zA-Z0-9-_-]+$/))
        error = `<strong>Name</strong> can only contain letters, numbers, dash (-) and underscore (_).`;
    else if (!is_valid_url(index_url))
        error = `<strong>Index URL</strong> must be a valid url.`;
    else if (!index_url.toLowerCase().startsWith('https://') && !index_url.toLowerCase().startsWith('http://'))
        error = `<strong>Index URL</strong> must start with 'https://' or 'http://'.`;
    // height must be a number
    else if (isNaN(height))
        error = `<strong>Window Height</strong> must be a number.`;
    // height must be greater than 0
    else if (height <= 0)
        error = `<strong>Window Height</strong> must be greater than 0.`;
    // width must be a number
    else if (isNaN(width))
        error = `<strong>Window Width</strong> must be a number.`;
    // width must be greater than 0
    else if (width <= 0)
        error = `<strong>Window Width</strong> must be greater than 0.`;
    // top must be a number
    else if (top && isNaN(top))
        error = `<strong>Window Top</strong> must be a number.`;
    // left must be a number
    else if (left && isNaN(left))
        error = `<strong>Window Left</strong> must be a number.`;

    // download icon from URL
    else {
        let icon_url = $('#edit-app-icon').attr('data-url');
        let icon_base64 = $('#edit-app-icon').attr('data-base64');

        if(icon_base64){
            icon = icon_base64;
        }else if (icon_url) {
            icon = await getBase64ImageFromUrl(icon_url);
            let app_max_icon_size = 5 * 1024 * 1024;
            if (icon.length > app_max_icon_size)
                error = `Icon cannot be larger than ${byte_format(app_max_icon_size)}`;
            // make sure icon is an image
            else if (!icon.startsWith('data:image/') && !icon.startsWith('data:application/octet-stream'))
                error = `Icon must be an image.`;
        }else{
            icon = null;
        }
    }

    // parse filetype_associations
    if(filetype_associations !== ''){
        filetype_associations = JSON.parse(filetype_associations);
        filetype_associations = filetype_associations.map((type) => {
            const fileType = type.value;
            if (
                !fileType ||
                fileType === "." ||
                fileType === "/"
            ) {
                error = `<strong>File Association Type</strong> must be valid.`;
                return null; // Return null for invalid cases
            }
            const lower = fileType.toLocaleLowerCase();

            if (fileType.includes("/")) {
            return lower;
            } else if (fileType.includes(".")) {
            return "." + lower.split(".")[1];
            } else {
            return "." + lower;
            }
        }).filter(Boolean);
    }

    // error?
    if (error) {
        $('#edit-app-error').show();
        $('#edit-app-error').html(error);
        document.body.scrollTop = document.documentElement.scrollTop = 0;
        return;
    }

    // show working spinner
    puter.ui.showSpinner();

    // disable submit button
    $('.edit-app-save-btn').prop('disabled', true);

    let socialImageUrl = null;
    if ($('#edit-app-social-image').attr('data-base64')) {
        socialImageUrl = await handleSocialImageUpload(name, $('#edit-app-social-image').attr('data-base64'));
    } else if ($('#edit-app-social-image').attr('data-url')) {
        socialImageUrl = $('#edit-app-social-image').attr('data-url');
    }
    
    puter.apps.update(currently_editing_app.name, {
        title: title,
        name: name,
        indexURL: index_url,
        icon: icon,
        description: description,
        maximizeOnStart: $('#edit-app-maximize-on-start').is(":checked"),
        background: $('#edit-app-background').is(":checked"),
        metadata: {
            fullpage_on_landing: $('#edit-app-fullpage-on-landing').is(":checked"),
            social_image: socialImageUrl,
            category: category || null,
            window_size: {
                width: width ?? 800,
                height: height ?? 600,
            },
            window_position: {
                top: top,
                left: left,
            },
            window_resizable: $('#edit-app-window-resizable').is(":checked"),
            hide_titlebar: $('#edit-app-hide-titlebar').is(":checked"),
            locked: $(`#edit-app-locked`).is(":checked") ?? false,
            credentialless: $(`#edit-app-credentialless`).is(":checked") ?? true,

        },
        filetypeAssociations: filetype_associations,
    }).then(async (app) => {
        currently_editing_app = app;
        trackOriginalValues();  // Update original values after save
        toggleSaveButton();  //Disable Save Button after succesful save
        toggleResetButton();  //DIsable Reset Button after succesful save
        $('#edit-app-error').hide();
        $('#edit-app-success').show();
        document.body.scrollTop = document.documentElement.scrollTop = 0;
        // Update open-app-btn
        $(`.open-app-btn[data-app-uid="${uid}"]`).attr('data-app-name', app.name);
        $(`.open-app[data-uid="${uid}"]`).attr('data-app-name', app.name);
        // Update title
        $(`.app-title[data-uid="${uid}"]`).html(html_encode(app.title));
        // Update app link
        $(`.app-url[data-uid="${uid}"]`).html(applink(app));
        $(`.app-url[data-uid="${uid}"]`).attr('href', applink(app));
        // Update icons
        $(`.app-icon[data-uid="${uid}"]`).attr('src', html_encode(app.icon ? app.icon : './img/app.svg'));
        $(`[data-app-uid="${uid}"]`).attr('data-app-title', html_encode(app.title));
        $(`[data-app-name="${uid}"]`).attr('data-app-name', html_encode(app.name));
    }).catch((err) => {
        $('#edit-app-success').hide();
        $('#edit-app-error').show();
        $('#edit-app-error').html(err.error?.message);
        // scroll to top so that user sees error message
        document.body.scrollTop = document.documentElement.scrollTop = 0;
        // re-enable submit button
        $('.edit-app-save-btn').prop('disabled', false);
    }).finally(() => {
        puter.ui.hideSpinner();
    })
})

$(document).on('input change', '#edit-app input, #edit-app textarea, #edit-app select', () => {
    toggleSaveButton();
    toggleResetButton();
});

$(document).on('click', '.edit-app-reset-btn', function () {
    resetToOriginalValues();
    toggleSaveButton();   // Disable Save button since values are reverted to original
    toggleResetButton();  //Disable Reset button since values are reverted to original
});

$(document).on('click', '.open-app-btn', async function (e) {
    puter.ui.launchApp($(this).attr('data-app-name'))
})

$('#earn-money-c2a-close').click(async function (e) {
    $('#earn-money').get(0).close();
    puter.kv.set('earn-money-c2a-closed', 'true')
})

$('#earn-money::backdrop').click(async function (e) {
    alert();
    $('#earn-money').get(0).close();
    puter.kv.set('earn-money-c2a-closed', 'true')
})

$(document).on('click', '.edit-app-open-app-btn', async function (e) {
    puter.ui.launchApp($(this).attr('data-app-name'))
})

$(document).on('click', '.delete-app-settings', async function (e) {
    let app_uid = $(this).attr('data-app-uid');
    let app_name = $(this).attr('data-app-name');
    let app_title = $(this).attr('data-app-title');

    // check if app is locked
    const app_data = await puter.apps.get(app_name, {icon_size: 16});

    if(app_data.metadata?.locked){
        puter.ui.alert(`<strong>${app_data.title}</strong> is locked and cannot be deleted.`, [
            {
                label: 'Ok',
            },
        ], {
            type: 'warning',
        });
        return;
    }

    // confirm delete
    const alert_resp = await puter.ui.alert(`Are you sure you want to premanently delete <strong>${html_encode(app_title)}</strong>?`,
        [
            {
                label: 'Yes, delete permanently',
                value: 'delete',
                type: 'danger',
            },
            {
                label: 'Cancel'
            },
        ]
    );

    if (alert_resp === 'delete') {
        let init_ts = Date.now();
        $('.deleting-app-modal')?.get(0)?.showModal();
        puter.apps.delete(app_name).then(async (app) => {
                setTimeout(() => {
                    $('.deleting-app-modal')?.get(0)?.close();
                    $('.back-to-main-btn').trigger('click');
                },
                    // make sure the modal was shown for at least 2 seconds
                    (Date.now() - init_ts) > 2000 ? 1 : 2000 - (Date.now() - init_ts));
                // get app directory
                puter.fs.stat({
                    path: `/${authUsername}/AppData/${dev_center_uid}/${app_uid}`,
                    returnSubdomains: true,
                }).then(async (stat) => {
                    // delete subdomain associated with the app dir
                    puter.hosting.delete(stat.subdomains[0].subdomain)
                    // delete app directory
                    puter.fs.delete(
                        `/${authUsername}/AppData/${dev_center_uid}/${app_uid}`,
                        { recursive: true }
                    )
                })
            }).catch(async (err) => {
                setTimeout(() => {
                    $('.deleting-app-modal')?.get(0)?.close();
                    puter.ui.alert(err?.message, [
                        {
                            label: 'Ok',
                        },
                    ]);
                },
                    (Date.now() - init_ts) > 2000 ? 1 : (2000 - (Date.now() - init_ts)));
            })
    }
})

$(document).on('click', '.edit-app', async function (e) {
    $('#edit-app-uid').val($(this).attr('data-app-uid'));
})

$(document).on('click', '.back-to-main-btn', function (e) {
    $('section:not(.sidebar)').hide();
    $('.tab-btn').removeClass('active');
    $('.tab-btn[data-tab="apps"]').addClass('active');

    // get apps
    $('#loading').show();
    setTimeout(function () {
        puter.apps.list({icon_size: 64}).then((apps_res) => {
            // uncheck the select all checkbox
            $('.select-all-apps').prop('checked', false);

            $('#loading').hide();
            apps = apps_res;
            if (apps.length > 0) {
                if (activeTab === 'apps') {
                    $('#no-apps-notice').hide();
                    $('#app-list').show();
                }
                $('.app-card').remove();
                apps.forEach(app => {
                    $('#app-list-table > tbody').append(generate_app_card(app));
                });
                count_apps();
                sort_apps();
            } else
                $('#no-apps-notice').show();
        })
    }, 1000);
})

function count_apps() {
    let count = 0;
    $('.app-card').each(function () {
        count++;
    })
    $('.app-count').html(count);
    return count;
}

// https://stackoverflow.com/a/43467144/1764493
function is_valid_url(string) {
    let url;

    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }

    return url.protocol === "http:" || url.protocol === "https:";
}

$(document).on('click', '#edit-app-icon-delete', async function (e) {
    $('#edit-app-icon').css('background-image', ``);
    $('#edit-app-icon').removeAttr('data-url');
    $('#edit-app-icon').removeAttr('data-base64');
    $('#edit-app-icon-delete').hide();

    toggleSaveButton();
    toggleResetButton();
})

$(document).on('click', '#edit-app-icon', async function (e) {
    const res2 = await puter.ui.showOpenFilePicker({
        accept: "image/*",
    });

    const icon = await puter.fs.read(res2.path);
    // convert blob to base64
    const reader = new FileReader();
    reader.readAsDataURL(icon);

    reader.onloadend = function () {
        let image = reader.result;
        // Get file extension
        let fileExtension = res2.name.split('.').pop();

        // Get MIME type
        let mimeType = getMimeType(fileExtension);

        // Replace MIME type in the data URL
        image = image.replace('data:application/octet-stream;base64', `data:${mimeType};base64`);

        $('#edit-app-icon').css('background-image', `url(${image})`);
        $('#edit-app-icon').attr('data-base64', image);
        $('#edit-app-icon-delete').show();

        toggleSaveButton();
        toggleResetButton();
    }
})

async function getBase64ImageFromUrl(imageUrl) {
    var res = await fetch(imageUrl);
    var blob = await res.blob();

    return new Promise((resolve, reject) => {
        var reader = new FileReader();
        reader.addEventListener("load", function () {
            resolve(reader.result);
        }, false);

        reader.onerror = () => {
            return reject(this);
        };
        reader.readAsDataURL(blob);
    })
}

/**
 * Generates HTML for an individual app card in the app list.
 * 
 * @param {Object} app - The app object containing details of the app.
 *  * 
 * @returns {string} HTML string representing the app card.
 * 
 * @description
 * This function creates an HTML string for an app card, which includes:
 * - Checkbox for app selection
 * - App icon and title
 * - Links to open, edit, add to desktop, or delete the app
 * - Display of app statistics (user count, open count)
 * - Creation date
 * - Incentive program status badge (if applicable)
 * 
 * The generated HTML is designed to be inserted into the app list table.
 * It includes data attributes for various interactive features and 
 * event handling.
 * 
 * @example
 * const appCardHTML = generate_app_card(myAppObject);
 * $('#app-list-table > tbody').append(appCardHTML);
 */
function generate_app_card(app) {
    let h = ``;
    h += `<tr class="app-card" data-uid="${html_encode(app.uid)}" data-title="${html_encode(app.title)}" data-name="${html_encode(app.name)}">`;
    // check box
    h += `<td style="height: 60px; width: 20px;">`;
        h += `<div style="width: 20px; height: 20px; margin-top: 20px; margin-right: 10px; flex-shrink:0;">`;
            h += `<input type="checkbox" class="app-checkbox" data-app-uid="${html_encode(app.uid)}" data-app-name="${html_encode(app.name)}" style="width: 20px; height: 20px;">`;
        h += `</div>`;
    h += `</td>`;
    // App info
    h += `<td style="height: 60px; width: 450px; display: flex; flex-direction: row; overflow:hidden;">`;
    // Icon
    h += `<div class="got-to-edit-app" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(app.title)}" data-app-locked="${html_encode(app.metadata?.locked)}" data-app-uid="${html_encode(app.uid)}" style="background-position: center; background-repeat: no-repeat; background-size: 92%; background-image:url(${app.icon === null ? './img/app.svg' : app.icon}); width: 60px; height: 60px; float:left; margin-bottom: -14px; color: #414b56; cursor: pointer; background-color: white; border-radius: 3px; flex-shrink:0;"></div>`;
    // Info
    h += `<div style="float:left; padding-left: 10px;">`;
    // Title
    h += `<h3 class="got-to-edit-app app-card-title" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(app.title)}" data-app-uid="${html_encode(app.uid)}">${html_encode(app.title)}${app.metadata?.locked ? lock_svg : ''}</h3>`;
    // // Category
    // if (app.metadata?.category) {
    //     const category = APP_CATEGORIES.find(c => c.id === app.metadata.category);
    //     if (category) {
    //         h += `<div class="app-categories">`;
    //         h += `<span class="app-category">${category.label}</span>`;
    //         h += `</div>`;
    //     }
    // }

    // link
    h += `<a class="app-card-link" href="${html_encode(applink(app))}" target="_blank">${html_encode(applink(app))}</a>`;

    // toolbar
    h += `<div style="" class="app-row-toolbar disable-user-select">`;

    // Open
    h += `<span title="Open app" class="open-app-btn" data-app-uid="${html_encode(app.uid)}" data-app-name="${html_encode(app.name)}" style="">Open</span>`;
    h += `<span style="margin-right: 10px; margin-left: 10px; color: #CCC; cursor:default;">&bull;</span>`;

    // Settings
    h += `<span title="Edit app" class="edit-app" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(app.title)}" data-app-uid="${html_encode(app.uid)}">Settings</span>`;
    h += `<span style="margin-right: 10px; margin-left: 10px; color: #CCC; cursor:default;">&bull;</span>`;

    // add to desktop
    h += `<span class="add-app-to-desktop" data-app-uid="${html_encode(app.uid)}" data-app-title="${html_encode(app.title)}">Add Shortcut to Desktop</span>`
    h += `<span style="margin-right: 10px; margin-left: 10px; color: #CCC; cursor:default;">&bull;</span>`;

    // Delete
    h += `<span title="Delete app" class="delete-app" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(app.title)}" data-app-uid="${html_encode(app.uid)}">Delete</span>`;
    h += `</div>`;
    h += `</td>`;

    // users count
    h += `<td style="margin-top:10px; font-size:15px; vertical-align:middle;">`;
    h += `<span title="Users" style="margin-right:20px; width: 100px; display: inline-block;"><img style="width: 20px; margin-right: 5px; margin-bottom: -4px;" src="./img/users.svg">${number_format((app.stats.referral_count ?? 0) + app.stats.user_count)}</span>`;
    h += `</td>`;

    // opens
    h += `<td style="margin-top:10px; font-size:15px; vertical-align:middle;">`;
    h += `<span title="Opens" style="width: 100px; display: inline-block;"><img style="width: 20px; margin-right: 5px; margin-bottom: -4px;" src="./img/views.svg">${number_format(app.stats.open_count)}</span>`;
    h += `</td>`;

    // Created
    h += `<td style="margin-top:10px; font-size:15px; vertical-align:middle;">`;
    h += `<span title="Created" style="width: 130px; display: inline-block;">${moment(app.created_at).format('MMM Do, YYYY')}</span>`;
    h += `</td>`;

    h += `<td style="vertical-align:middle; min-width:200px;">`;
        h += `<div style="overflow: hidden; height: 100%; display: flex; justify-content: center; align-items: center;">`;
            // "Approved for listing"
            h += `<span class="approval-badge approval-badge-lsiting ${app.approved_for_listing ? 'active' : ''}" title="${app.approved_for_listing ? 'Approved for listing in the App Center' : 'Not approved for listing in the App Center'}"></span>`;

            // "Approved for opening items"
            h += `<span class="approval-badge approval-badge-opening ${app.approved_for_opening_items ? 'active' : ''}" title="${app.approved_for_opening_items ? 'Approved for opening items' : 'Not approved for opening items'}"></span>`;

            // "Approved for incentive program"
            h += `<span class="approval-badge approval-badge-incentive ${app.approved_for_incentive_program ? 'active' : ''}" title="${app.approved_for_incentive_program ? 'Approved for the incentive program' : 'Not approved for the incentive program'}"></span>`;
        h += `</div>`;
    h += `</td>`;
    h += `</tr>`;
    return h;
}

/**
 * Formats a binary-byte integer into the human-readable form with units.
 * 
 * @param {integer} bytes 
 * @returns 
 */
window.byte_format = (bytes) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
};

/**
 * check if a string is a valid email address
 */
function validateEmail(email) {
    var re = /\S+@\S+\.\S+/;
    return re.test(email);
}

/**
 * Formats a number with grouped thousands.
 *
 * @param {number|string} number - The number to be formatted. If a string is provided, it must only contain numerical characters, plus and minus signs, and the letter 'E' or 'e' (for scientific notation).
 * @param {number} decimals - The number of decimal points. If a non-finite number is provided, it defaults to 0.
 * @param {string} [dec_point='.'] - The character used for the decimal point. Defaults to '.' if not provided.
 * @param {string} [thousands_sep=','] - The character used for the thousands separator. Defaults to ',' if not provided.
 * @returns {string} The formatted number with grouped thousands, using the specified decimal point and thousands separator characters.
 * @throws {TypeError} If the `number` parameter cannot be converted to a finite number, or if the `decimals` parameter is non-finite and cannot be converted to an absolute number.
 */
function number_format(number, decimals, dec_point, thousands_sep) {
    // Strip all characters but numerical ones.
    number = (number + '').replace(/[^0-9+\-Ee.]/g, '');
    var n = !isFinite(+number) ? 0 : +number,
        prec = !isFinite(+decimals) ? 0 : Math.abs(decimals),
        sep = (typeof thousands_sep === 'undefined') ? ',' : thousands_sep,
        dec = (typeof dec_point === 'undefined') ? '.' : dec_point,
        s = '',
        toFixedFix = function (n, prec) {
            var k = Math.pow(10, prec);
            return '' + Math.round(n * k) / k;
        };
    // Fix for IE parseFloat(0.55).toFixed(0) = 0;
    s = (prec ? toFixedFix(n, prec) : '' + Math.round(n)).split('.');
    if (s[0].length > 3) {
        s[0] = s[0].replace(/\B(?=(?:\d{3})+(?!\d))/g, sep);
    }
    if ((s[1] || '').length < prec) {
        s[1] = s[1] || '';
        s[1] += new Array(prec - s[1].length + 1).join('0');
    }
    return s.join(dec);
}

$(document).on('click', '.close-message', function () {
    $($(this).attr('data-target')).fadeOut();
});

$('th.sort').on('click', function (e) {
    // determine what column to sort by
    const sortByColumn = $(this).attr('data-column');

    // toggle sort direction
    if (sortByColumn === sortBy) {
        if (sortDirection === 'asc')
            sortDirection = 'desc';
        else
            sortDirection = 'asc';
    }
    else {
        sortBy = sortByColumn;
        sortDirection = 'desc';
    }

    // update arrow
    $('.sort-arrow').css('display', 'none');
    $('#app-list-table').find('th').removeClass('sorted');
    $(this).find('.sort-arrow-' + sortDirection).css('display', 'inline');
    $(this).addClass('sorted');

    sort_apps();
});

function sort_apps() {
    let sorted_apps;

    // sort
    if (sortDirection === 'asc'){
        sorted_apps = apps.sort((a, b) => {
            if(sortBy === 'name'){
                return a[sortBy].localeCompare(b[sortBy]);
            }else if(sortBy === 'created_at'){
                return new Date(a[sortBy]) - new Date(b[sortBy]);
            } else if(sortBy === 'user_count' || sortBy === 'open_count'){
                return a.stats[sortBy] - b.stats[sortBy];
            }else{
                a[sortBy] > b[sortBy] ? 1 : -1
            }
        });
    }else{
        sorted_apps = apps.sort((a, b) => {
            if(sortBy === 'name'){
                return b[sortBy].localeCompare(a[sortBy]);
            }else if(sortBy === 'created_at'){
                return new Date(b[sortBy]) - new Date(a[sortBy]);
            } else if(sortBy === 'user_count' || sortBy === 'open_count'){
                return b.stats[sortBy] - a.stats[sortBy];
            }else{
                b[sortBy] > a[sortBy] ? 1 : -1
            }
        });
    }
    // refresh app list
    $('.app-card').remove();
    sorted_apps.forEach(app => {
        $('#app-list-table > tbody').append(generate_app_card(app));
    });

    count_apps();

    // show apps that match search_query and hide apps that don't
    if (search_query) {
        // show apps that match search_query and hide apps that don't
        apps.forEach((app) => {
            if (app.title.toLowerCase().includes(search_query.toLowerCase())) {
                $(`.app-card[data-name="${html_encode(app.name)}"]`).show();
            } else {
                $(`.app-card[data-name="${html_encode(app.name)}"]`).hide();
            }
        })
    }
}

/**
 * Checks if the items being deployed contain a .git directory
 * @param {Array|string} items - Items to check (can be path string or array of items)
 * @returns {Promise<boolean>} - True if .git directory is found
 */
async function hasGitDirectory(items) {
    // Case 1: Single Puter path
    if (typeof items === 'string' && (items.startsWith('/') || items.startsWith('~'))) {
        const stat = await puter.fs.stat(items);
        if (stat.is_dir) {
            const files = await puter.fs.readdir(items);
            return files.some(file => file.name === '.git' && file.is_dir);
        }
        return false;
    }
    
    // Case 2: Array of Puter items
    if (Array.isArray(items) && items[0]?.uid) {
        return items.some(item => item.name === '.git' && item.is_dir);
    }
    
    // Case 3: Local items (DataTransferItems)
    if (Array.isArray(items)) {
        for (let item of items) {
            if (item.fullPath?.includes('/.git/') || 
                item.path?.includes('/.git/') || 
                item.filepath?.includes('/.git/')) {
                return true;
            }
        }
    }
    
    return false;
}

/**
 * Shows a warning dialog about .git directory deployment
 * @returns {Promise<boolean>} - True if the user wants to proceed with deployment
 */
async function showGitWarningDialog() {
    try {
        // Check if the user has chosen to skip the warning
        const skipWarning = await puter.kv.get('skip-git-warning');

        // Log retrieved value for debugging
        console.log('Retrieved skip-git-warning:', skipWarning);

        // If the user opted to skip the warning, proceed without showing it
        if (skipWarning === true) {
            return true;
        }
    } catch (error) {
        console.error('Error accessing KV store:', error);
        // If KV store access fails, fall back to showing the dialog
    }

    // Create the modal dialog
    const modal = document.createElement('div');
    modal.innerHTML = `
        <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2); z-index: 10000;">
            <h3 style="margin-top: 0;">Warning: Git Repository Detected</h3>
            <p>A .git directory was found in your deployment files. Deploying .git directories may:</p>
            <ul>
                <li>Expose sensitive information like commit history and configuration</li>
                <li>Significantly increase deployment size</li>
            </ul>
            <div style="margin-top: 15px; display: flex; align-items: center;">
                <input type="checkbox" id="skip-git-warning" style="margin-right: 10px;">
                <label for="skip-git-warning" style="margin-top:0;">Don't show this warning again</label>
            </div>
            <div style="margin-top: 15px; display: flex; justify-content: flex-end;">
                <button id="cancel-deployment" style="margin-right: 10px; padding: 10px 15px; background: #f0f0f0; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                <button id="continue-deployment" style="padding: 10px 15px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Continue Deployment</button>
            </div>
        </div>
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); z-index: 9999;"></div>
    `;
    document.body.appendChild(modal);

    return new Promise((resolve) => {
        // Handle "Continue Deployment"
        document.getElementById('continue-deployment').addEventListener('click', async () => {
            try {
                const skipChecked = document.getElementById('skip-git-warning')?.checked;
                if (skipChecked) {
                    console.log("Saving 'skip-git-warning' preference as true");
                    await puter.kv.set('skip-git-warning', true);
                }
            } catch (error) {
                console.error('Error saving user preference to KV store:', error);
            } finally {
                document.body.removeChild(modal);
                resolve(true); // Continue deployment
            }
        });

        // Handle "Cancel Deployment"
        document.getElementById('cancel-deployment').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(false); // Cancel deployment
        });
    });
}

window.deploy = async function (app, items) {
    // Check for .git directory before proceeding
    try {
        if (await hasGitDirectory(items)) {
            const shouldProceed = await showGitWarningDialog();
            if (!shouldProceed) {
                reset_drop_area();
                return;
            }
        }
    } catch (err) {
        console.error('Error checking for .git directory:', err);
    }
    let appdata_dir, current_app_dir;

    // disable deploy button
    $('.deploy-btn').addClass('disabled');

    // change drop area text
    $('.drop-area').html(deploying_spinner + ' <div>Deploying <span class="deploy-percent">(0%)</span></div>');

    if (typeof items === 'string' && (items.startsWith('/') || items.startsWith('~'))) {
        $('.drop-area').removeClass('drop-area-hover');
        $('.drop-area').addClass('drop-area-ready-to-deploy');
    }

    // --------------------------------------------------------------------
    // Get current directory, we need to delete the existing hostname
    // later on
    // --------------------------------------------------------------------
    try {
        current_app_dir = await puter.fs.stat({
            path: `/${authUsername}/AppData/${dev_center_uid}/${app.uid ?? app.uuid}`,
            returnSubdomains: true
        });
    } catch (err) {
        console.log(err);
    }

    // --------------------------------------------------------------------
    // Delete existing hostnames attached to this app directory if they exist
    // --------------------------------------------------------------------
    if (current_app_dir?.subdomains.length > 0) {
        for (let subdomain of current_app_dir?.subdomains) {
            puter.hosting.delete(subdomain.subdomain)
        }
    }

    // --------------------------------------------------------------------
    // Delete existing app directory
    // --------------------------------------------------------------------
    try {
        await puter.fs.delete(current_app_dir.path)
    } catch (err) {
        console.log(err);
    }

    // --------------------------------------------------------------------
    // Make an app directory under AppData
    // if the directory already exists, it should be overwritten
    // --------------------------------------------------------------------
    try {
        appdata_dir = await puter.fs.mkdir(
            // path
            `/${authUsername}/AppData/${dev_center_uid}/${app.uid ?? app.uuid}`,
            // options
            { overwrite: true, recursive: true, rename: false }
        )
    } catch (err) {
        console.log(err);
    }

    // --------------------------------------------------------------------
    // (A) One Puter Item: If 'items' is a string and starts with /, it's a path to a Puter item
    // --------------------------------------------------------------------
    if (typeof items === 'string' && (items.startsWith('/') || items.startsWith('~'))) {
        // perform stat on 'items'
        const stat = await puter.fs.stat(items);

        // --------------------------------------------------------------------
        // Puter Directory
        // --------------------------------------------------------------------
        // Perform readdir on 'items'
        // todo there is apparently a bug in Puter where sometimes path is literally missing from the items
        // returned by readdir. This is the 'path' that readdit didn't return a path for: "~/Desktop/particle-clicker-master"
        if (stat.is_dir) {
            const files = await puter.fs.readdir(items);
            // copy the 'files' to the app directory
            if (files.length > 0) {
                for (let file of files) {
                    // perform copy
                    await puter.fs.copy(
                        file.path,
                        appdata_dir.path,
                        { overwrite: true }
                    );
                    // update progress
                    $('.deploy-percent').text(`(${Math.round((files.indexOf(file) / files.length) * 100)}%)`);
                }
            }
        }
        // --------------------------------------------------------------------
        // Puter File
        // --------------------------------------------------------------------
        else {
            // copy the 'files' to the app directory
            await puter.fs.copy(
                items,
                appdata_dir.path,
                { overwrite: true }
            );
        }

        // generate new hostname with a random suffix
        let hostname = `${currently_editing_app.name}-${(Math.random() + 1).toString(36).substring(7)}`;

        // --------------------------------------------------------------------
        // Create a router for the app with the fresh hostname
        // we change hostname every time to prevent caching issues
        // --------------------------------------------------------------------
        puter.hosting.create(hostname, appdata_dir.path).then(async (res) => {
            // TODO this endpoint needs to be able to update only the specified fields
            puter.apps.update(currently_editing_app.name, {
                indexURL: protocol + `://${hostname}.` + static_hosting_domain,
                title: currently_editing_app.title,
                name: currently_editing_app.name,
                icon: currently_editing_app.icon,
                description: currently_editing_app.description,
                maximizeOnStart: currently_editing_app.maximize_on_start,
                background: currently_editing_app.background,
                filetypeAssociations: currently_editing_app.filetype_associations,
            })
            // set the 'Index URL' field for the 'Settings' tab
            $('#edit-app-index-url').val(protocol + `://${hostname}.` + static_hosting_domain);
            // show success message
            $('.deploy-success-msg').show();
            // reset drop area
            reset_drop_area();
        })
    }
    // --------------------------------------------------------------------
    // (B) Multiple Puter Items: If `items` is an Array `items[0]` has `uid` 
    // then it's a Puter Item Array.
    // --------------------------------------------------------------------
    else if (Array.isArray(items) && items[0].uid) {
        // If there's no index.html in the root, return
        if (!hasRootIndexHtml)
            return;

        // copy the 'files' to the app directory
        for (let item of items) {
            // perform copy
            await puter.fs.copy(
                item.fullPath ? item.fullPath : item.path ? item.path : item.filepath,
                appdata_dir.path,
                { overwrite: true }
            );
            // update progress
            $('.deploy-percent').text(`(${Math.round((items.indexOf(item) / items.length) * 100)}%)`);
        }

        // generate new hostname with a random suffix
        let hostname = `${currently_editing_app.name}-${(Math.random() + 1).toString(36).substring(7)}`;

        // --------------------------------------------------------------------
        // Create a router for the app with the fresh hostname
        // we change hostname every time to prevent caching issues
        // --------------------------------------------------------------------
        puter.hosting.create(hostname, appdata_dir.path).then(async (res) => {
            // TODO this endpoint needs to be able to update only the specified fields
            puter.apps.update(currently_editing_app.name, {
                indexURL: protocol + `://${hostname}.` + static_hosting_domain,
                title: currently_editing_app.title,
                name: currently_editing_app.name,
                icon: currently_editing_app.icon,
                description: currently_editing_app.description,
                maximizeOnStart: currently_editing_app.maximize_on_start,
                background: currently_editing_app.background,
                filetypeAssociations: currently_editing_app.filetype_associations,
            })
            // set the 'Index URL' field for the 'Settings' tab
            $('#edit-app-index-url').val(protocol + `://${hostname}.` + static_hosting_domain);
            // show success message
            $('.deploy-success-msg').show();
            // reset drop area
            reset_drop_area();
        })
    }

    // --------------------------------------------------------------------
    // (C) Local Items: Upload new deploy
    // --------------------------------------------------------------------
    else {
        puter.fs.upload(
            items,
            `/${authUsername}/AppData/${dev_center_uid}/${currently_editing_app.uid}`,
            {
                dedupeName: false,
                overwrite: false,
                parsedDataTransferItems: true,
                createMissingAncestors: true,
                progress: function (operation_id, op_progress) {
                    $('.deploy-percent').text(`(${op_progress}%)`);
                },
            }).then(async (uploaded) => {
                // new hostname
                let hostname = `${currently_editing_app.name}-${(Math.random() + 1).toString(36).substring(7)}`;

                // ----------------------------------------
                // Create a router for the app with a fresh hostname
                // we change hostname every time to prevent caching issues
                // ----------------------------------------
                puter.hosting.create(hostname, appdata_dir.path).then(async (res) => {
                    // TODO this endpoint needs to be able to update only the specified fields
                    puter.apps.update(currently_editing_app.name, {
                        indexURL: protocol + `://${hostname}.` + static_hosting_domain,
                        title: currently_editing_app.title,
                        name: currently_editing_app.name,
                        icon: currently_editing_app.icon,
                        description: currently_editing_app.description,
                        maximizeOnStart: currently_editing_app.maximize_on_start,
                        background: currently_editing_app.background,
                        filetypeAssociations: currently_editing_app.filetype_associations,
                    })
                    // set the 'Index URL' field for the 'Settings' tab
                    $('#edit-app-index-url').val(protocol + `://${hostname}.` + static_hosting_domain);
                    // show success message
                    $('.deploy-success-msg').show();
                    // reset drop area
                    reset_drop_area()
                })
            })
    }
}

$(document).on('click', '.section-tab-btn', function (e) {
    // hide all tabs
    $('.section-tab').hide();
    // show section
    $('.section-tab[data-tab="' + $(this).attr('data-tab') + '"]').show();
    // remove active class from all tab buttons
    $('.section-tab-btn').removeClass('active');
    // add active class to clicked tab button
    $(this).addClass('active');
})

function generateDirTree(paths) {
    const root = {};

    for (let path of paths) {
        let parts = path.split('/');
        let currentNode = root;
        for (let part of parts) {
            if (!part) continue; // skip empty parts, especially leading one
            if (!currentNode[part]) {
                currentNode[part] = {};
            }
            currentNode = currentNode[part];
        }
    }

    return root;
}

function setRootDirTree(tree, items) {
    // Get all keys (directories and files) in the root
    const rootKeys = Object.keys(tree);

    // If there's only one object in the root, check if it's non-empty and return it
    if (rootKeys.length === 1 && typeof tree[rootKeys[0]] === 'object' && Object.keys(tree[rootKeys[0]]).length > 0) {
        let newItems = [];
        for (let item of items) {
            if (item.fullPath)
                item.finalPath = item.fullPath.replace(rootKeys[0], '');
            else if (item.path)
                item.path = item.path.replace(rootKeys[0], '');
            else
                item.filepath = item.filepath.replace(rootKeys[0], '');

            newItems.push(item);
        }
        return newItems;
    } else {
        return items;
    }
}

function hasRootIndexHtml(tree) {
    // Check if index.html exists in the root
    if (tree['index.html']) {
        return true;
    }

    // Get all keys (directories and files) in the root
    const rootKeys = Object.keys(tree);

    // If there's only one directory in the root, check if index.html exists in that directory
    if (rootKeys.length === 1 && typeof tree[rootKeys[0]] === 'object' && tree[rootKeys[0]]['index.html']) {
        return true;
    }

    return false;
}

$(document).on('click', '.close-success-msg', function (e) {
    $(this).closest('div').fadeOut();
})

$(document).on('click', '.open-app', function (e) {
    puter.ui.launchApp($(this).attr('data-app-name'));
})

$(document).on('click', '.insta-deploy-to-new-app', async function (e) {
    $('.insta-deploy-modal').get(0).close();
    let title = await puter.ui.prompt('Please enter a title for your app:', 'My Awesome App');

    if (title.length > 60) {
        puter.ui.alert(`Title cannot be longer than 60.`, [
            {
                label: 'Ok',
            },
        ]);
        // todo go back to create an app prompt and prefill the title input with the title the user entered
        $('.insta-deploy-modal').get(0).showModal();
    }
    else if (title) {
        if (source_path) {
            create_app(title, source_path);
            source_path = null;
        } else {
            create_app(title, null, dropped_items);
            dropped_items = null;
        }
    } else
        $('.insta-deploy-modal').get(0).showModal();

    return;

})

$(document).on('click', '.insta-deploy-to-existing-app', function (e) {
    $('.insta-deploy-modal').get(0).close();
    $('.insta-deploy-existing-app-select').get(0).showModal();
    $('.insta-deploy-existing-app-list').html(`<div style="margin: 100px auto 10px auto; width: 40px; height:40px;">${loading_spinner}</div>`);
    puter.apps.list({ icon_size: 64 }).then((apps) => {
        setTimeout(() => {
            $('.insta-deploy-existing-app-list').html('');
            if (apps.length === 0)
                $('.insta-deploy-existing-app-list').html(`
                    <div class="no-existing-apps">
                    <img src="./img/apps-black.svg" style="width: 40px; height: 40px; opacity: 0.2; display: block; margin: 100px auto 10px auto;">
                        You have no existing apps.
                    </div>
                `);
            else {
                for (let app of apps) {
                    $('.insta-deploy-existing-app-list').append(
                        `<div class="insta-deploy-app-selector" data-uid="${app.uid}" data-name="${html_encode(app.name)}">
                            <img class="insta-deploy-app-icon" data-uid="${app.uid}" data-name="${html_encode(app.name)}" src="${app.icon ? html_encode(app.icon) : './img/app.svg'}">
                            <span style="display: inline-block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; width: 180px; text-wrap: nowrap;" data-uid="${app.uid}" data-uid="${html_encode(app.name)}">${html_encode(app.title)}</span>
                            <div style="margin-top: 10px; font-size:14px; opacity:0.7; display:inline-block;">
                                <span title="Users" style="width:90px; display: inline-block;"><img style="width: 15px; margin-right: 5px; margin-bottom: -2px;" src="./img/users.svg">${number_format((app.stats.referral_count ?? 0) + app.stats.user_count)}</span>
                                <span title="Opens" style="display: inline-block;"><img style="width: 15px; margin-right: 5px; margin-bottom: -2px;" src="./img/views.svg">${number_format(app.stats.open_count)}</span>
                            </div>
                        </div>`
                    );
                }
            }
        }, 500);
    })

    // todo reset .insta-deploy-existing-app-list on close
})

$(document).on('click', '.insta-deploy-app-selector', function (e) {
    $('.insta-deploy-app-selector').removeClass('active');
    $(this).addClass('active');

    // enable deploy button
    $('.insta-deploy-existing-app-deploy-btn').removeClass('disabled');
})

$(document).on('click', '.insta-deploy-existing-app-deploy-btn', function (e) {
    $('.insta-deploy-existing-app-deploy-btn').addClass('disabled');
    $('.insta-deploy-existing-app-select')?.get(0)?.close();
    // load the 'App Settings' section
    edit_app_section($('.insta-deploy-app-selector.active').attr('data-name'));

    $('.drop-area').removeClass('drop-area-hover');
    $('.drop-area').addClass('drop-area-ready-to-deploy');
    let drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">Ready to deploy 🚀</p><p class="reset-deploy"><span>Cancel</span></p>`;
    $('.drop-area').html(drop_area_content);

    // deploy
    deploy({ uid: $(e.target).attr('data-uid') }, source_path ?? dropped_items);
    $('.insta-deploy-existing-app-list').html('');
})

$(document).on('click', '.insta-deploy-cancel', function (e) {
    $(this).closest('dialog')?.get(0)?.close();
})
$(document).on('click', '.insta-deploy-existing-app-back', function (e) {
    $('.insta-deploy-existing-app-select')?.get(0)?.close();
    $('.insta-deploy-modal')?.get(0)?.showModal();
    // disable deploy button
    $('.insta-deploy-existing-app-deploy-btn').addClass('disabled');

    // todo disable the 'an existing app' option if there are no existing apps
})


$(document).on('click', '.add-app-to-desktop', function (e) {
    let app_title = $(this).attr('data-app-title');
    let app_uid = $(this).attr('data-app-uid');

    puter.fs.upload(
        new File([], app_title),
        `/${authUsername}/Desktop`,
        {
            name: app_title,
            dedupeName: true,
            overwrite: false,
            appUID: app_uid,
        }).then(async (uploaded) => {
            puter.ui.alert(`<strong>${app_title}</strong> shortcut has been added to your desktop.`, [
                {
                    label: 'Ok',
                    type: 'primary',
                },
            ], {
                type: 'success',
            });
        })

})

function reset_drop_area() {
    dropped_items = null;
    $('.drop-area').html(drop_area_placeholder);
    $('.drop-area').removeClass('drop-area-ready-to-deploy');
    $('.deploy-btn').addClass('disabled');
}

$('body').on('dragover', function (event) {
    // skip if the user is dragging something over the drop area
    if ($(event.target).hasClass('drop-area'))
        return;

    event.preventDefault();  // Prevent the default behavior
    event.stopPropagation(); // Stop the event from propagating
});

// Developers can drop items anywhere on the page to deploy them
$('body').on('drop', async function (event) {
    // skip if the user is dragging something over the drop area
    if ($(event.target).hasClass('drop-area'))
        return;

    // prevent default behavior
    event.preventDefault();
    event.stopPropagation();

    // retrieve puter items from the event
    if (event.detail?.items?.length > 0) {
        dropped_items = event.detail.items;
        source_path = dropped_items[0].path;
        // by deploying an existing Puter folder. So we create the app and deploy it.
        if (source_path) {
            // todo if there are no apps, go straight to creating a new app
            $('.insta-deploy-modal').get(0).showModal();
            // set item name
            $('.insta-deploy-item-name').html(html_encode(dropped_items[0].name));
        }
    }
    //-----------------------------------------------------------------------------
    // Local items dropped
    //-----------------------------------------------------------------------------
    const e = event.originalEvent;
    if (!e.dataTransfer || !e.dataTransfer.items || e.dataTransfer.items.length === 0)
        return;

    // Get dropped items
    dropped_items = await puter.ui.getEntriesFromDataTransferItems(e.dataTransfer.items);

    // Generate a flat array of full paths from the dropped items
    let paths = [];
    for (let item of dropped_items) {
        paths.push('/' + (item.fullPath ?? item.filepath));
    }

    // Generate a directory tree from the paths
    let tree = generateDirTree(paths);

    dropped_items = setRootDirTree(tree, dropped_items);

    // Alert if no index.html in root
    if (!hasRootIndexHtml(tree)) {
        puter.ui.alert(index_missing_error, [
            {
                label: 'Ok',
            },
        ]);
        $('.drop-area').removeClass('drop-area-ready-to-deploy');
        $('.deploy-btn').addClass('disabled');
        dropped_items = [];
        return;
    }

    // Get all keys (directories and files) in the root
    const rootKeys = Object.keys(tree);

    // Generate a list of items in the root in the form of a string (e.g. /index.html, /css/style.css) with maximum of 3 items
    let rootItems = '';

    if (rootKeys.length === 1)
        rootItems = rootKeys[0];
    else if (rootKeys.length === 2)
        rootItems = rootKeys[0] + ', ' + rootKeys[1];
    else if (rootKeys.length === 3)
        rootItems = rootKeys[0] + ', ' + rootKeys[1] + ', and' + rootKeys[1];
    else if (rootKeys.length > 3)
        rootItems = rootKeys[0] + ', ' + rootKeys[1] + ', and ' + (rootKeys.length - 2) + ' more item' + (rootKeys.length - 2 > 1 ? 's' : '');

    // Show insta-deploy modal
    $('.insta-deploy-modal').get(0)?.showModal();

    // Set item name
    $('.insta-deploy-item-name').html(html_encode(rootItems));
});

$('.insta-deploy-existing-app-select').on('close', function (e) {
    $('.insta-deploy-existing-app-list').html('');
})

$('.refresh-app-list').on('click', function (e) {
    $('.loading-modal').get(0)?.showModal();

    puter.apps.list({ icon_size: 64 }).then((resp) => {
        setTimeout(() => {
            apps = resp;

            $('.app-card').remove();
            apps.forEach(app => {
                $('#app-list-table > tbody').append(generate_app_card(app));
            });

            count_apps();

            // preserve search query
            if (search_query) {
                // show apps that match search_query and hide apps that don't
                apps.forEach((app) => {
                    if (app.title.toLowerCase().includes(search_query.toLowerCase())) {
                        $(`.app-card[data-name="${app.name}"]`).show();
                    } else {
                        $(`.app-card[data-name="${app.name}"]`).hide();
                    }
                })
            }

            // preserve sort
            sort_apps();

            $('.loading-modal').get(0).close();
        }, 1000);
    })
})

$(document).on('click', '.search', function (e) {
    e.stopPropagation();
    e.preventDefault();
    // don't let click bubble up to window
    e.stopImmediatePropagation();
})

$(document).on('input change keyup keypress keydown paste cut', '.search', function (e) {
    // search apps for query
    search_query = $(this).val().toLowerCase();
    if (search_query === '') {
        // hide 'clear search' button
        $('.search-clear').hide();
        // show all apps again
        $(`.app-card`).show();
    } else {
        // show 'clear search' button
        $('.search-clear').show();
        // show apps that match search_query and hide apps that don't
        apps.forEach((app) => {
            if (
                app.title.toLowerCase().includes(search_query.toLowerCase())
                || app.name.toLowerCase().includes(search_query.toLowerCase())
                || app.description.toLowerCase().includes(search_query.toLowerCase())
                || app.uid.toLowerCase().includes(search_query.toLowerCase())
            )
            {
                $(`.app-card[data-name="${app.name}"]`).show();
            } else {
                $(`.app-card[data-name="${app.name}"]`).hide();
            }
        })
    }
})

$(document).on('click', '.search-clear', function (e) {
    $('.search').val('');
    $('.search').trigger('change');
    $('.search').focus();
    search_query = '';
})

$(document).on('change', '.app-checkbox', function (e) {
    // determine if select-all checkbox should be checked, indeterminate, or unchecked
    if ($('.app-checkbox:checked').length === $('.app-checkbox').length) {
        $('.select-all-apps').prop('indeterminate', false);
        $('.select-all-apps').prop('checked', true);
    } else if ($('.app-checkbox:checked').length > 0) {
        $('.select-all-apps').prop('indeterminate', true);
        $('.select-all-apps').prop('checked', false);
    }
    else {
        $('.select-all-apps').prop('indeterminate', false);
        $('.select-all-apps').prop('checked', false);
    }

    // activate row
    if ($(this).is(':checked'))
        $(this).closest('tr').addClass('active');
    else
        $(this).closest('tr').removeClass('active');

    // enable delete button if at least one checkbox is checked
    if ($('.app-checkbox:checked').length > 0)
        $('.delete-apps-btn').removeClass('disabled');
    else
        $('.delete-apps-btn').addClass('disabled');

})

$(document).on('click', '.delete-apps-btn', async function (e) {
    // show confirmation alert
    let resp = await puter.ui.alert(`Are you sure you want to delete the selected apps?`, [
        {
            label: 'Delete',
            type: 'danger',
            value: 'delete',
        },
        {
            label: 'Cancel',
        },
    ], {
        type: 'warning',
    });

    if (resp === 'delete') {
        // disable delete button
        // $('.delete-apps-btn').addClass('disabled');

        // show 'deleting' modal
        $('.deleting-app-modal')?.get(0)?.showModal();

        let start_ts = Date.now();
        const apps = $('.app-checkbox:checked').toArray();

        // delete all checked apps
        for (let app of apps) {
            // get app uid
            const app_uid = $(app).attr('data-app-uid');
            const app_name = $(app).attr('data-app-name');

            // get app
            const app_data = await puter.apps.get(app_name, {icon_size: 64 });

            if(app_data.metadata?.locked){
                if(apps.length === 1){
                    puter.ui.alert(`<strong>${app_data.title}</strong> is locked and cannot be deleted.`, [
                        {
                            label: 'Ok',
                        },
                    ], {
                        type: 'warning',
                    });

                    break;
                }

                let resp = await puter.ui.alert(`<strong>${app_data.title}</strong> is locked and cannot be deleted.`, [
                    {
                        label: 'Skip and Continue',
                        value: 'Continue',
                        type: 'primary'
                    },
                    {
                        label: 'Cancel',
                    },
                ], {
                    type: 'warning',
                });

                if(resp === 'Cancel')
                    break;
                else if(resp === 'Continue')
                    continue;
                else
                    continue;
            }

            // delete app 
            await puter.apps.delete(app_name)

            // remove app card
            $(`.app-card[data-uid="${app_uid}"]`).fadeOut(200, function name(params) {
                $(this).remove();
                if ($(`.app-card`).length === 0) {
                    $('section:not(.sidebar)').hide();
                    $('#no-apps-notice').show();
                } else {
                    $('section:not(.sidebar)').hide();
                    $('#app-list').show();
                }
                count_apps();
            });

            try{
                // get app directory
                const stat = await puter.fs.stat({
                    path: `/${authUsername}/AppData/${dev_center_uid}/${app_uid}`,
                    returnSubdomains: true
                });
                // delete subdomain associated with the app directory
                if(stat?.subdomains[0]?.subdomain){
                        await puter.hosting.delete(stat.subdomains[0].subdomain)
                }
                // delete app directory
                await puter.fs.delete(
                    `/${authUsername}/AppData/${dev_center_uid}/${app_uid}`,
                    { recursive: true }
                )
                count_apps();
            } catch(err) {
                console.log(err);
            }
        }

        // close 'deleting' modal
        setTimeout(() => {
            $('.deleting-app-modal')?.get(0)?.close();
            if($('.app-checkbox:checked').length === 0){
                // disable delete button
                $('.delete-apps-btn').addClass('disabled');
                // reset the 'select all' checkbox
                $('.select-all-apps').prop('indeterminate', false);
                $('.select-all-apps').prop('checked', false);
            }
        }, (start_ts - Date.now()) > 500 ? 0 : 500);
    }
})

$(document).on('change', '.select-all-apps', function (e) {
    if ($(this).is(':checked')) {
        $('.app-checkbox').prop('checked', true);
        $('.app-card').addClass('active');
        $('.delete-apps-btn').removeClass('disabled');
    } else {
        $('.app-checkbox').prop('checked', false);
        $('.app-card').removeClass('active');
        $('.delete-apps-btn').addClass('disabled');
    }
})

/**
 * Get the MIME type for a given file extension.
 *
 * @param {string} extension - The file extension (with or without leading dot).
 * @returns {string} The corresponding MIME type, or 'application/octet-stream' if not found.
 */
function getMimeType(extension) {
    const mimeTypes = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        bmp: 'image/bmp',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        tiff: 'image/tiff',
        ico: 'image/x-icon'
    };

    // Remove leading dot if present and convert to lowercase
    const cleanExtension = extension.replace(/^\./, '').toLowerCase();

    // Return the MIME type if found, otherwise return 'application/octet-stream'
    return mimeTypes[cleanExtension] || 'application/octet-stream';
}

// if edit-app-maximize-on-start is checked, disable window size and position fields
$(document).on('change', '#edit-app-maximize-on-start', function (e) {
    if ($(this).is(':checked')) {
        $('#edit-app-window-width, #edit-app-window-height').prop('disabled', true);
        $('#edit-app-window-top, #edit-app-window-left').prop('disabled', true);
    } else {
        $('#edit-app-window-width, #edit-app-window-height').prop('disabled', false);
        $('#edit-app-window-top, #edit-app-window-left').prop('disabled', false);
    }
})

$(document).on('change', '#edit-app-background', function (e) {
    if($('#edit-app-background').is(":checked")){
        disable_window_settings()
    }else{
        enable_window_settings()
    }
})

function disable_window_settings(){
    $('#edit-app-maximize-on-start').prop('disabled', true);
    $('#edit-app-fullpage-on-landing').prop('disabled', true);
    $('#edit-app-window-width, #edit-app-window-height').prop('disabled', true);
    $('#edit-app-window-top, #edit-app-window-left').prop('disabled', true);
    $('#edit-app-window-resizable').prop('disabled', true);
    $('#edit-app-hide-titlebar').prop('disabled', true);
}

function enable_window_settings(){
    $('#edit-app-maximize-on-start').prop('disabled', false);
    $('#edit-app-fullpage-on-landing').prop('disabled', false);
    $('#edit-app-window-width, #edit-app-window-height').prop('disabled', false);
    $('#edit-app-window-top, #edit-app-window-left').prop('disabled', false);
    $('#edit-app-window-resizable').prop('disabled', false);
    $('#edit-app-hide-titlebar').prop('disabled', false);
}

$(document).on('click', '.reset-deploy', function (e) {
    reset_drop_area();
})

$(document).on('click', '.sidebar-toggle', function (e) {
    $('.sidebar').toggleClass('open');
    $('body').toggleClass('sidebar-open');
})

async function initializeAssetsDirectory() {
    try {
        // Check if assets_url exists
        const existingURL = await puter.kv.get('assets_url');
        if (!existingURL) {
            // Create assets directory
            const assetsDir = await puter.fs.mkdir(
                `/${authUsername}/AppData/${dev_center_uid}/assets`,
                { overwrite: false }
            );
            
            // Publish the directory
            const hostname = `assets-${Math.random().toString(36).substring(2)}`;
            const route = await puter.hosting.create(hostname, assetsDir.path);
            
            // Store the URL
            await puter.kv.set('assets_url', `https://${hostname}.puter.site`);
        }
    } catch (err) {
        console.error('Error initializing assets directory:', err);
    }
}

function generateSocialImageSection(app) {
    return `
        <label for="edit-app-social-image">Social Graph Image (1200×630 strongly recommended)</label>
        <div id="edit-app-social-image" class="social-image-preview" ${app.metadata?.social_image ? `style="background-image:url(${html_encode(app.metadata.social_image)})" data-url="${html_encode(app.metadata.social_image)}" data-base64="${html_encode(app.metadata.social_image)}"` : ''}>
            <div id="change-social-image">Change Social Image</div>
        </div>
        <span id="edit-app-social-image-delete" style="${app.metadata?.social_image ? 'display:block;' : ''}">Remove social image</span>
        <p class="social-image-help">This image will be displayed when your app is shared on social media.</p>
    `;
}


$(document).on('click', '#edit-app-social-image', async function(e) {
    const res = await puter.ui.showOpenFilePicker({
        accept: "image/*",
    });

    const socialImage = await puter.fs.read(res.path);
    // Convert blob to base64 for preview
    const reader = new FileReader();
    reader.readAsDataURL(socialImage);

    reader.onloadend = function() {
        let image = reader.result;
        // Get file extension
        let fileExtension = res.name.split('.').pop();
        // Get MIME type
        let mimeType = getMimeType(fileExtension);
        // Replace MIME type in the data URL
        image = image.replace('data:application/octet-stream;base64', `data:image/${mimeType};base64`);

        $('#edit-app-social-image').css('background-image', `url(${image})`);
        $('#edit-app-social-image').attr('data-base64', image);
        $('#edit-app-social-image-delete').show();

        toggleSaveButton();
        toggleResetButton();
    }
});

$(document).on('click', '#edit-app-social-image-delete', async function(e) {
    $('#edit-app-social-image').css('background-image', '');
    $('#edit-app-social-image').removeAttr('data-url');
    $('#edit-app-social-image').removeAttr('data-base64');
    $('#edit-app-social-image-delete').hide();
});

async function handleSocialImageUpload(app_name, socialImageData) {
    if (!socialImageData) return null;

    try {
        const assets_url = await puter.kv.get('assets_url');
        if (!assets_url) throw new Error('Assets URL not found');

        // Convert base64 to blob
        const base64Response = await fetch(socialImageData);
        const blob = await base64Response.blob();

        // Get assets directory path
        const assetsDir = `/${authUsername}/AppData/${dev_center_uid}/assets`;
        
        // Upload new image
        await puter.fs.upload(
            new File([blob], `${app_name}.png`, { type: 'image/png' }),
            assetsDir,
            { overwrite: true }
        );

        return `${assets_url}/${app_name}.png`;
    } catch (err) {
        console.error('Error uploading social image:', err);
        throw err;
    }
}

$(document).on('click', '.copy-app-uid', function(e) {
    const appUID = $('#edit-app-uid').val();
    navigator.clipboard.writeText(appUID);
    // change to 'copied'
    $(this).html('Copied');
    setTimeout(() => {
        $(this).html(copy_svg);
    }, 2000);
});

$(document).on('change', '#analytics-period', async function(e) {
    puter.ui.showSpinner();

    // set a sensible stats_grouping based on the selected period
    let stats_grouping;

    if ($(this).val() === 'today' || $(this).val() === 'yesterday') {
        stats_grouping = 'hour';
    }
    else if ($(this).val() === 'this_week' || $(this).val() === 'last_week' || $(this).val() === 'this_month' || $(this).val() === 'last_month' || $(this).val() === '7d' || $(this).val() === '30d') {
        stats_grouping = 'day';
    }
    else if ($(this).val() === 'this_year' || $(this).val() === 'last_year' || $(this).val() === '12m' || $(this).val() === 'all') {
        stats_grouping = 'month';
    }

    const app = await puter.apps.get(
        currently_editing_app.name, 
        { 
            icon_size: 16, 
            stats_period: $(this).val(),
            stats_grouping: stats_grouping,
        }
    );

    $('#analytics-users .count').html(number_format(app.stats.user_count));
    $('#analytics-opens .count').html(number_format(app.stats.open_count));

    // Clear existing chart if any
    $('#analytics-chart').remove();
    $('.analytics-container').remove();

    // Create new canvas
    const container = $('<div class="analytics-container" style="width:100%; height:400px; margin-top:30px;"></div>');
    const canvas = $('<canvas id="analytics-chart"></canvas>');
    container.append(canvas);
    $('#analytics-opens').parent().after(container);

    // Format the data
    const labels = app.stats.grouped_stats.open_count.map(item => item.period);
    const openData = app.stats.grouped_stats.open_count.map(item => item.count);
    const userData = app.stats.grouped_stats.user_count.map(item => item.count);

    // Create chart
    const ctx = document.getElementById('analytics-chart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Opens',
                    data: openData,
                    borderColor: '#8884d8',
                    tension: 0.1,
                    fill: false
                },
                {
                    label: 'Users',
                    data: userData,
                    borderColor: '#82ca9d',
                    tension: 0.1,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Period'
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Count'
                    }
                }
            }
        }
    });

    puter.ui.hideSpinner();
});