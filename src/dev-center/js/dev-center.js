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

const deploying_spinner = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner_P7sC{transform-origin:center;animation:spinner_svv2 .75s infinite linear}@keyframes spinner_svv2{100%{transform:rotate(360deg)}}</style><path d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" class="spinner_P7sC"/></svg>`;
const loading_spinner = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner_P7sC{transform-origin:center;animation:spinner_svv2 .75s infinite linear}@keyframes spinner_svv2{100%{transform:rotate(360deg)}}</style><path d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" class="spinner_P7sC"/></svg>`;
const drop_area_placeholder = `<p>Drop your app folder and files here to deploy.</p><p style="font-size: 16px; margin-top: 0px;">HTML, JS, CSS, ...</p>`;
const index_missing_error = `Please upload an 'index.html' file or if you're uploading a directory, make sure it contains an 'index.html' file at its root.`;

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

// port
if (URLParams.has('puter.port') && URLParams.get('puter.port')) {
    static_hosting_domain = static_hosting_domain + `:` + URLParams.get('puter.port');
}

// protocol
let protocol = 'https';
if (URLParams.has('puter.protocol')) {
    protocol = URLParams.get('puter.protocol');
}

// port
let port = '';
if (URLParams.has('puter.port') && URLParams.get('puter.port')) {
    port = URLParams.get('puter.port');
}

$(document).ready(function () {
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
        puter.apps.list().then((resp) => {
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
        puter.apps.list().then((apps_res) => {
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
    let name = slugify(title + '-' + Math.random().toString(36).substring(2), {
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
            const route = await puter.hosting.create(name, app_dir.path);

            // ----------------------------------------------------
            // Update the app with the new hostname
            // ----------------------------------------------------
            puter.apps.update(app.name, {
                title: title,
                name: name,
                indexURL: source_path ? protocol + `://${name}.` + static_hosting_domain : 'https://dev-center.puter.com/coming-soon.html',
                icon: icon,
                description: ' ',
                maximizeOnStart: false,
                background: false,
            }).then(async (app) => {
                // refresh app list
                puter.apps.list().then(async (resp) => {
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

    // confirm delete
    const alert_resp = await puter.ui.alert(`Are you sure you want to premanently delete "${html_encode(app_title)}"?`,
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

    let h = ``;
    h += `
        <div class="edit-app-navbar">
            <div style="float:left; min-width: 700px;">
                <img class="app-icon" data-uid="${html_encode(app.uid)}" src="${html_encode(!app.icon ? './img/app.svg' : app.icon)}">
                <h3 class="app-title" data-uid="${html_encode(app.uid)}">${html_encode(app.title)}</h3>
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
            <form style="clear:both;">
                <div class="error" id="edit-app-error"></div>
                <div class="success" id="edit-app-success">App has been successfully updated.<span class="close-success-msg">&times;</span></div>
                <input type="hidden" id="edit-app-uid" value="${html_encode(app.uid)}">

                <label for="edit-app-title">Title</label>
                <input type="text" id="edit-app-title" placeholder="My Awesome App!" value="${html_encode(app.title)}">

                <label for="edit-app-name">Name</label>
                <input type="text" id="edit-app-name" placeholder="my-awesome-app" style="font-family: monospace;" value="${html_encode(app.name)}">

                <label for="edit-app-index-url">Index URL</label>
                <input type="text" id="edit-app-index-url" placeholder="https://example-app.com/index.html" value="${html_encode(app.index_url)}">
                
                <label for="edit-app-app-id">App ID</label>
                <input type="text" style="width: 362px;" class="app-uid" value="${html_encode(app.uid)}" readonly>

                <div>
                    <input type="checkbox" id="edit-app-maximize-on-start" name="edit-app-maximize-on-start" value="true" style="margin-top:30px;" ${app.maximize_on_start ? 'checked' : ''}>
                    <label for="edit-app-maximize-on-start" style="display: inline;">Maximize window on start</label>
                </div>
                
                <div>
                    <input type="checkbox" id="edit-app-background" name="edit-app-background" value="true" style="margin-top:30px;" ${app.background ? 'checked' : ''}>
                    <label for="edit-app-background" style="display: inline;">Run as a background process.</label>
                </div>

                <div>
                    <input type="checkbox" id="edit-app-fullpage-on-landing" name="edit-app-fullpage-on-landing" value="true" style="margin-top:30px;" ${app.metadata?.fullpage_on_landing ? 'checked' : ''}>
                    <label for="edit-app-fullpage-on-landing" style="display: inline;">Load in full-page mode when a user lands directly on this app.</label>
                </div>

                <label for="edit-app-icon">Icon</label>
                <div id="edit-app-icon" style="background-image:url(${!app.icon ? './img/app.svg' : html_encode(app.icon)});" ${app.icon ? 'data-url="' + html_encode(app.icon) + '"' : ''}>
                    <div id="change-app-icon">Change App Icon</div>
                </div>
                <span id="edit-app-icon-delete" style="${app.icon ? 'display:block;' : ''}">Remove icon</span>

                <label for="edit-app-description">Description</label>
                <textarea id="edit-app-description">${html_encode(app.description)}</textarea>
                
                <label for="edit-app-filetype-associations">File Associations</label>
                <p style="margin-top: 10px; font-size:13px;">A comma-separated list of file type specifiers. For example if you include <code>.txt</code>, your apps could be opened when a user clicks on a TXT file.</p>
                <textarea id="edit-app-filetype-associations" placeholder=".txt, .jpg, application/json">${app.filetype_associations}</textarea>

                <button type="button" class="edit-app-save-btn button button-primary">Save</button>
            </form>
        </div>
    `
    return h;
}

async function edit_app_section(cur_app_name) {
    $('section:not(.sidebar)').hide();
    $('.tab-btn').removeClass('active');
    $('.tab-btn[data-tab="apps"]').addClass('active');

    let cur_app = await puter.apps.get(cur_app_name);
    currently_editing_app = cur_app;

    // generate edit app section
    let edit_app_section_html = generate_edit_app_section(cur_app);
    $('#edit-app').html(edit_app_section_html);
    $('#edit-app').show();

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
                // one file dropped
                // ----------------------------------------------------
                if (items.length === 1 && !items[0].isDirectory) {
                    if (items[0].name.toLowerCase() === 'index.html') {
                        dropped_items = items[0].path;
                        $('.drop-area').removeClass('drop-area-hover');
                        $('.drop-area').addClass('drop-area-ready-to-deploy');
                        drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">index.html</p><p>Ready to deploy 🚀</p>`;
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
                // one directory dropped
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
                            drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">${rootItems}</p><p>Ready to deploy 🚀</p>`;
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

            $('.drop-area').removeClass('drop-area-hover');
            $('.drop-area').addClass('drop-area-ready-to-deploy');
            drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">${rootItems}</p><p>Ready to deploy 🚀</p>`;
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

    // error?
    if (error) {
        $('#edit-app-error').show();
        $('#edit-app-error').html(error);
        document.body.scrollTop = document.documentElement.scrollTop = 0;
        return;
    }

    // parse filetype_associations
    filetype_associations = filetype_associations.split(',').map(element => element.trim());
    // disable submit button
    $('.edit-app-save-btn').prop('disabled', true);

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
        },
        filetypeAssociations: filetype_associations,
    }).then(async (app) => {
        currently_editing_app = app;
        $('#edit-app-error').hide();
        $('#edit-app-success').show();
        document.body.scrollTop = document.documentElement.scrollTop = 0;
        // Re-enable submit button
        $('.edit-app-save-btn').prop('disabled', false);
        // Update open-app-btn
        $(`.open-app-btn[data-app-uid="${uid}"]`).attr('data-app-name', app.name);
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
    })
})

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

    // confirm delete
    const alert_resp = await puter.ui.alert(`Are you sure you want to premanently delete "${html_encode(app_title)}"?`,
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
        puter.apps.list().then((apps_res) => {
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
                sort_apps()
            } else
                $('#no-apps-notice').show();
        })
    }, 1000);
})

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
        image = image.replace('data:application/octet-stream;base64', `data:image/${mimeType};base64`);

        $('#edit-app-icon').css('background-image', `url(${image})`);
        $('#edit-app-icon').attr('data-base64', image);
        $('#edit-app-icon-delete').show();
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
    h += `<div class="got-to-edit-app" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(app.title)}" data-app-uid="${html_encode(app.uid)}" style="background-position: center; background-repeat: no-repeat; background-size: 92%; background-image:url(${app.icon === null ? './img/app.svg' : app.icon}); width: 60px; height: 60px; float:left; margin-bottom: -14px; color: #414b56; cursor: pointer; background-color: white; border-radius: 3px; flex-shrink:0;"></div>`;
    // Info
    h += `<div style="float:left; padding-left: 10px;">`;
    // Title
    h += `<h3 class="got-to-edit-app app-card-title" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(app.title)}" data-app-uid="${html_encode(app.uid)}">${html_encode(app.title)}</h3>`;
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

    // "Approved for incentive program"
    if (app.approved_for_incentive_program)
        h += `<span style="float:right;
                color: green;
                background: #c6f6c6;
                padding: 4px;
                font-size: 12px;
                border-radius: 5px;
                margin-top: 0; border:1px solid green;">✔ Incentive Program</span>`;
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
    if (sortDirection === 'asc')
        sorted_apps = apps.sort((a, b) => a[sortBy] > b[sortBy] ? 1 : -1);
    else
        sorted_apps = apps.sort((a, b) => a[sortBy] < b[sortBy] ? 1 : -1);

    // refresh app list
    $('.app-card').remove();
    sorted_apps.forEach(app => {
        $('#app-list-table > tbody').append(generate_app_card(app));
    });

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

window.deploy = async function (app, items) {
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
    // (A) Puter Items: If 'items' is a string and starts with /, it's a path to a Puter item
    // --------------------------------------------------------------------
    if (typeof items === 'string' && (items.startsWith('/') || items.startsWith('~'))) {
        // perform stat on 'items'
        const stat = await puter.fs.stat(items);

        // Puter Directory
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
        // Puter File
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
    // (B) Local Items: Upload new deploy
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
    puter.apps.list().then((apps) => {
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
    let drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">Ready to deploy 🚀</p>`;
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
            puter.ui.alert(`"${app_title}" shortcut has been added to your desktop.`, [
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

    puter.apps.list().then((resp) => {
        setTimeout(() => {
            apps = resp;

            $('.app-card').remove();
            apps.forEach(app => {
                $('#app-list-table > tbody').append(generate_app_card(app));
            });

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
            if (app.title.toLowerCase().includes(search_query.toLowerCase())) {
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
        $('.delete-apps-btn').addClass('disabled');

        // show 'deleting' modal
        $('.deleting-app-modal')?.get(0)?.showModal();

        let start_ts = Date.now();
        const apps = $('.app-checkbox:checked').toArray();

        // delete all checked apps
        for (let app of apps) {
            // get app uid
            const app_uid = $(app).attr('data-app-uid');
            const app_name = $(app).attr('data-app-name');

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
            } catch(err) {
                console.log(err);
            }
        }

        // close 'deleting' modal
        setTimeout(() => {
            $('.deleting-app-modal')?.get(0)?.close();
            // uncheck all checkboxes
            $('.app-checkbox').prop('checked', false);
            // disable delete button
            $('.delete-apps-btn').addClass('disabled');
            // reset the 'select all' checkbox
            $('.select-all-apps').prop('indeterminate', false);
            $('.select-all-apps').prop('checked', false);
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