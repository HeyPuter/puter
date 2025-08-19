let source_path
let apps = [];
let sortBy = 'created_at';
let sortDirection = 'desc';
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

async function init_apps() {
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
                window.developer = dev_profile;
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
                    $('.tab-btn-separator').show();
                }
            })
        }
        // Get apps
        puter.apps.list({ icon_size: 64 }).then((resp) => {
            apps = resp;

            // hide loading
            puter.ui.hideSpinner();

            // set apps
            if (apps.length > 0) {
                if (window.activeTab === 'apps') {
                    $('#no-apps-notice').hide();
                    $('#app-list').show();
                }
                $('.app-card').remove();
                apps.forEach(app => {
                    $('#app-list-table > tbody').append(generate_app_card(app));
                });
                count_apps();
                sort_apps();
                activate_tippy();
            } else {
                $('#no-apps-notice').show();
            }
        })
    }, 1000);

}


/**
 * Refreshes the list of apps in the UI.
 * 
 * @param {boolean} [show_loading=false] - Whether to show a loading indicator while refreshing.
 * 
 */

window.refresh_app_list = (show_loading = false) => {
    if (show_loading)
        puter.ui.showSpinner();
    // get apps
    setTimeout(function () {
        // uncheck the select all checkbox
        $('.select-all-apps').prop('checked', false);

        puter.apps.list({ icon_size: 64 }).then((apps_res) => {
            puter.ui.hideSpinner();
            apps = apps_res;
            if (apps.length > 0) {
                if (window.activeTab === 'apps') {
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
            activate_tippy();
            puter.ui.hideSpinner();
        })
    }, show_loading ? 1000 : 0);
}

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
    
    puter.ui.showSpinner();

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
                fullpage_on_landing: true,
            },
        })
        .then(async (app) => {
            let app_dir;
            // ----------------------------------------------------
            // Create app directory in AppData
            // ----------------------------------------------------
            app_dir = await puter.fs.mkdir(
                `/${auth_username}/AppData/${dev_center_uid}/${app.uid}`,
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
                metadata: {
                    category: null, // default category on creation
                    window_resizable: true,
                    fullpage_on_landing: true,
                }
            }).then(async (app) => {
                // refresh app list
                puter.apps.list({ icon_size: 64 }).then(async (resp) => {
                    apps = resp;
                    // Close the 'Creating new app...' modal
                    // but make sure it was shown for at least 2 seconds
                    setTimeout(() => {
                        // open edit app section
                        edit_app_section(app.name);

                        // set drop area if source_path was provided or items were dropped
                        if (source_path || items) {
                            $('.drop-area').removeClass('drop-area-hover');
                            $('.drop-area').addClass('drop-area-ready-to-deploy');
                        }
                        puter.ui.hideSpinner();
                        // deploy app if source_path was provided
                        if (source_path) {
                            deploy(app, source_path);
                        } else if (items) {
                            deploy(app, items);
                        }
                        activate_tippy();
                    }, (Date.now() - start_ts) > 2000 ? 1 : 2000 - (Date.now() - start_ts));
                })
            }).catch(async (err) => {
                console.log(err);
             })
            // ----------------------------------------------------
            // Create a "shortcut" on the desktop
            // ----------------------------------------------------
            puter.fs.upload(new File([], app.title),
                `/${auth_username}/Desktop`,
                {
                    name: app.title,
                    dedupeName: true,
                    overwrite: false,
                    appUID: app.uid,
                }
            )
            //----------------------------------------------------
            // Increment app count
            //----------------------------------------------------
            $('.app-count').html(parseInt($('.app-count').html() ?? 0) + 1);

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

$(document).on('click', '.edit-app, .go-to-edit-app', function (e) {
    const cur_app_name = $(this).attr('data-app-name')
    edit_app_section(cur_app_name);
})

$(document).on('click', '.delete-app', async function (e) {
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
                <h3 class="app-title" data-uid="${html_encode(app.uid)}">${html_encode(app.title)}${app.metadata?.locked ? lock_svg_tippy : ''}</h3>
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
               <p style="margin-top: 5px; font-size:13px;">You can paste multiple extensions at once (comma, space, or tab separated) or press comma to add each extension.</p>
               <textarea id="edit-app-filetype-associations"  placeholder="Paste multiple extensions like: .txt, .doc, .pdf, application/json">${JSON.stringify(app.filetype_associations.map(item => ({ "value": item })), null, app.filetype_associations.length).replace(/</g, '\\u003c')}</textarea>

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
                    <label for="edit-app-locked" style="display: inline;">Delete Protection${lock_svg}</label>
                    <p>When enabled, the app cannot be deleted. This is useful for preventing accidental deletion of important apps.</p>
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
                <option value="this_week">This week</option>
                <option value="last_week">Last week</option>
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

window.reset_drop_area = () => {
    dropped_items = null;
    $('.drop-area').html(drop_area_placeholder);
    $('.drop-area').removeClass('drop-area-ready-to-deploy');
    $('.deploy-btn').addClass('disabled');
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

async function edit_app_section(cur_app_name, tab = 'deploy') {
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

    render_analytics('today')

    // show the correct tab
    $('.section-tab').hide();
    $(`.section-tab[data-tab="${tab}"]`).show();
    $('.section-tab-buttons .section-tab-btn').removeClass('active');
    $(`.section-tab-buttons .section-tab-btn[data-tab="${tab}"]`).addClass('active');
    
    const filetype_association_input = document.querySelector('textarea[id=edit-app-filetype-associations]');
    let tagify = new Tagify(filetype_association_input, {
        pattern: /\.(?:[a-z0-9]+)|(?:[a-z]+\/(?:[a-z0-9.-]+|\*))/,
        delimiters: ",",  // Use comma as delimiter
        duplicates: false, // Prevent duplicate tags
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

    try {
        activate_tippy();
    } catch (e) {
        console.log('no tippy:', e);
    }

    // Custom function to handle bulk pasting of file extensions
    if (tagify) {
        // Create a completely separate paste handler
        const handleBulkPaste = function(e) {
            const clipboardData = e.clipboardData || window.clipboardData;
            if (!clipboardData) return;
            
            const pastedText = clipboardData.getData('text');
            if (!pastedText) return;
            
            // Check if the pasted text contains delimiters
            if (/[,;\t\s]/.test(pastedText)) {
                e.stopPropagation();
                e.preventDefault();
                
                // Process the pasted text to extract extensions
                const extensions = pastedText.split(/[,;\t\s]+/)
                    .map(ext => ext.trim())
                    .filter(ext => ext && (ext.startsWith('.') || ext.includes('/')));
                
                if (extensions.length > 0) {
                    // Get existing values to prevent duplicates
                    const existingValues = tagify.value.map(tag => tag.value);
                    
                    // Only add extensions that don't already exist
                    const newExtensions = extensions.filter(ext => !existingValues.includes(ext));
                    
                    if (newExtensions.length > 0) {
                        // Add the new tags
                        tagify.addTags(newExtensions);
                        
                        // Update the UI
                        setTimeout(() => {
                            toggleSaveButton();
                            toggleResetButton();
                        }, 10);
                    }
                }
                
                // Clear the input element to prevent any text concatenation
                setTimeout(() => {
                    if (tagify.DOM.input) {
                        tagify.DOM.input.textContent = '';
                    }
                }, 10);
            }
        };
        
        // Add the paste handler directly to the tagify wrapper element
        const tagifyWrapper = tagify.DOM.scope;
        if (tagifyWrapper) {
            tagifyWrapper.addEventListener('paste', handleBulkPaste, true);
        }
        
        // Also add it to the input element for better coverage
        if (tagify.DOM.input) {
            tagify.DOM.input.addEventListener('paste', handleBulkPaste, true);
        }
        
        // Add a comma key handler to support adding tags with comma
        tagify.DOM.input.addEventListener('keydown', function(e) {
            if (e.key === ',' && tagify.DOM.input.textContent.trim()) {
                e.preventDefault();
                
                const text = tagify.DOM.input.textContent.trim();
                
                // Only add valid extensions
                if ((text.startsWith('.') || text.includes('/')) && 
                    tagify.settings.pattern.test(text)) {
                    
                    // Check for duplicates
                    const existingValues = tagify.value.map(tag => tag.value);
                    
                    if (!existingValues.includes(text)) {
                        tagify.addTags([text]);
                        
                        // Update UI
                        setTimeout(() => {
                            toggleSaveButton();
                            toggleResetButton();
                        }, 10);
                    }
                    
                    // Always clear the input
                    tagify.DOM.input.textContent = '';
                }
            }
        });
    }
}

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
        puter.ui.showSpinner();
        puter.apps.delete(app_name).then(async (app) => {
                setTimeout(() => {
                    puter.ui.hideSpinner();
                    $('.back-to-main-btn').trigger('click');
                },
                    // make sure the modal was shown for at least 2 seconds
                    (Date.now() - init_ts) > 2000 ? 1 : 2000 - (Date.now() - init_ts));
                // get app directory
                puter.fs.stat({
                    path: `/${auth_username}/AppData/${dev_center_uid}/${app_uid}`,
                    returnSubdomains: true,
                }).then(async (stat) => {
                    // delete subdomain associated with the app dir
                    puter.hosting.delete(stat.subdomains[0].subdomain)
                    // delete app directory
                    puter.fs.delete(
                        `/${auth_username}/AppData/${dev_center_uid}/${app_uid}`,
                        { recursive: true }
                    )
                })
            }).catch(async (err) => {
                setTimeout(() => {
                    puter.ui.hideSpinner();
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
    puter.ui.showSpinner();
    setTimeout(function () {
        puter.apps.list({icon_size: 64}).then((apps_res) => {
            // uncheck the select all checkbox
            $('.select-all-apps').prop('checked', false);

            puter.ui.hideSpinner();
            apps = apps_res;
            if (apps.length > 0) {
                if (window.activeTab === 'apps') {
                    $('#no-apps-notice').hide();
                    $('#app-list').show();
                }
                $('.app-card').remove();
                apps.forEach(app => {
                    $('#app-list-table > tbody').append(generate_app_card(app));
                });
                count_apps();
                sort_apps();
                activate_tippy();
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
    $('.app-count').html(count ? count : '');
    return count;
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
    h += `<tr class="app-card" data-uid="${html_encode(app.uid)}" data-title="${html_encode(app.title)}" data-name="${html_encode(app.name)}" style="height: 86px;">`;
        // check box
        h += `<td style="height: 60px; width: 20px; display: flex ; align-items: center;">`;
            h += `<div style="width: 20px; height: 20px; margin-top: 20px; margin-right: 10px; flex-shrink:0;">`;
                h += `<input type="checkbox" class="app-checkbox" data-app-uid="${html_encode(app.uid)}" data-app-name="${html_encode(app.name)}">`;
            h += `</div>`;
        h += `</td>`;
    
        // App info (title, category, toolbar)
        h += `<td style="height: 72px; width: 450px;">`;

    // Wrapper for icon + content side by side
    h += `<div style="display: flex; flex-direction: row; align-items: center; height: 86px; overflow: hidden;">`;

    // Icon
    h += `<div class="go-to-edit-app" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(app.title)}" data-app-locked="${html_encode(app.metadata?.locked)}" data-app-uid="${html_encode(app.uid)}" style="
      background-position: center;
      background-repeat: no-repeat;
      background-size: 92%;
      background-image: url(${app.icon === null ? './img/app.svg' : app.icon});
      width: 60px;
      height: 60px;
      margin-right: 10px;
      color: #414b56;
      cursor: pointer;
      background-color: white;
      border-radius: 3px;
      flex-shrink: 0;
    "></div>`;

    // App info content
    h += `<div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%; overflow: visible;">`;

    // Info block with fixed layout
    h += `<div style="display: flex; flex-direction: column; justify-content: center; padding-left: 10px; flex-grow: 1; overflow: hidden; gap: 1px; height: 100%;">`;

    // Title
    h += `<h3 class="go-to-edit-app app-card-title" style="
    margin: 0;
    font-size: 16px;
    line-height: 20px;
    height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  " data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(app.title)}" data-app-uid="${html_encode(app.uid)}">
    ${html_encode(app.title)}${app.metadata?.locked ? lock_svg_tippy : ''}
  </h3>`;

  // Category (optional)
  if (app.metadata?.category) {
    const category = APP_CATEGORIES.find(c => c.id === app.metadata.category);
    if (category) {
      h += `<span class="app-category" >${html_encode(category.label)}</span>`;
    }
  }

  // Link
  h += `<a class="app-card-link" href="${html_encode(applink(app))}" target="_blank" style="
    font-size: 13px;
    margin: 2px 0 0 0;
    color: #2563eb;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-decoration: none;
  ">${html_encode(applink(app))}</a>`;

h += `</div>`;



    h += `</div>`; // end info column
    h += `</div>`; // end row
h += `</td>`;


    // users count
    h += `<td style="margin-top:10px; font-size:15px; vertical-align:middle;">`;
        h += `<span class="stats-cell" data-app-name="${html_encode(app.name)}" data-app-uid="${html_encode(app.uid)}" title="Users" style="margin-right:20px;"><img src="./img/users.svg">${number_format((app.stats.referral_count ?? 0) + app.stats.user_count)}</span>`;
    h += `</td>`;

    // opens
    h += `<td style="margin-top:10px; font-size:15px; vertical-align:middle;">`;
        h += `<span class="stats-cell" data-app-name="${html_encode(app.name)}" data-app-uid="${html_encode(app.uid)}" title="Opens"><img src="./img/views.svg">${number_format(app.stats.open_count)}</span>`;
    h += `</td>`;

    // Created
    h += `<td style="margin-top:10px; font-size:15px; vertical-align:middle;">`;
    h += `<span title="Created" style="width: 130px; display: inline-block; font-size: 14px;">${moment(app.created_at).format('MMM Do, YYYY')}</span>`;
    h += `</td>`;

    h += `<td style="vertical-align:middle; min-width:200px;">`;
        h += `<div style="overflow: hidden; height: 100%; display: flex; justify-content: center; align-items: center;">`;
            // "Approved for listing"
            h += `<span class="tippy approval-badge approval-badge-lsiting ${app.approved_for_listing ? 'active' : ''}" title="${app.approved_for_listing ? '✅ Approved for listing in the App Center' : '❌ Not approved for listing in the App Center'}"></span>`;

            // "Approved for opening items"
            h += `<span class="tippy approval-badge approval-badge-opening ${app.approved_for_opening_items ? 'active' : ''}" title="${app.approved_for_opening_items ? '✅ Approved for opening items' : '❌ Not approved for opening items'}"></span>`;

            // "Approved for incentive program"
            h += `<span class="tippy approval-badge approval-badge-incentive ${app.approved_for_incentive_program ? 'active' : ''}" title="${app.approved_for_incentive_program ? '✅ Approved for the incentive program' : '❌ Not approved for the incentive program'}"></span>`;
        h += `</div>`;
    h += `</td>`;

    // options
    h += `<td style="vertical-align: middle;"><img class="options-icon options-icon-app" data-app-name="${html_encode(app.name)}" data-app-uid="${html_encode(app.uid)}" data-app-title="${html_encode(app.title)}" src="./img/options.svg"></td>`;

    h += `</tr>`;
    return h;
}

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
            path: `/${auth_username}/AppData/${dev_center_uid}/${app.uid ?? app.uuid}`,
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
            `/${auth_username}/AppData/${dev_center_uid}/${app.uid ?? app.uuid}`,
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
            `/${auth_username}/AppData/${dev_center_uid}/${currently_editing_app.uid}`,
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

    const app_item = $('.insta-deploy-app-selector.active');

    // load the 'App Settings' section
    edit_app_section(app_item.attr('data-name'));

    $('.drop-area').removeClass('drop-area-hover');
    $('.drop-area').addClass('drop-area-ready-to-deploy');
    let drop_area_content = `<p style="margin-bottom:0; font-weight: 500;">Ready to deploy 🚀</p><p class="reset-deploy"><span>Cancel</span></p>`;
    $('.drop-area').html(drop_area_content);

    // deploy
    console.log('data uid is present?', $(e.target).attr('data-uid'), app_item.attr('data-uid'));
    deploy({ uid: app_item.attr('data-uid') }, source_path ?? dropped_items);
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



$('.insta-deploy-existing-app-select').on('close', function (e) {
    $('.insta-deploy-existing-app-list').html('');
})

$('.refresh-app-list').on('click', function (e) {
    puter.ui.showSpinner();

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
            activate_tippy();

            puter.ui.hideSpinner();
        }, 1000);
    })
})

$(document).on('click', '.search-apps', function (e) {
    e.stopPropagation();
    e.preventDefault();
    // don't let click bubble up to window
    e.stopImmediatePropagation();
})

$(document).on('input change keyup keypress keydown paste cut', '.search-apps', function (e) {
    search_apps();
})

window.search_apps = function() {
    // search apps for query
    search_query = $('.search-apps').val().toLowerCase();
    if (search_query === '') {
        // hide 'clear search' button
        $('.search-clear-apps').hide();
        // show all apps again
        $(`.app-card`).show();
        // remove 'has-value' class from search input
        $('.search-apps').removeClass('has-value');
    } else {
        // show 'clear search' button
        $('.search-clear-apps').show();
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
        // add 'has-value' class to search input
        $('.search-apps').addClass('has-value');
    }    
}

$(document).on('click', '.search-clear-apps', function (e) {
    $('.search-apps').val('');
    $('.search-apps').trigger('change');
    $('.search-apps').focus();
    search_query = '';
    // remove 'has-value' class from search input
    $('.search-apps').removeClass('has-value');
})

$(document).on('click', '.app-checkbox', function (e) {
    // was shift key pressed?
    if (e.originalEvent && e.originalEvent.shiftKey) {
        // select all checkboxes in range
        const currentIndex = $('.app-checkbox').index(this);
        const startIndex = Math.min(window.last_clicked_app_checkbox_index, currentIndex);
        const endIndex = Math.max(window.last_clicked_app_checkbox_index, currentIndex);

        // set all checkboxes in range to the same state as current checkbox
        for (let i = startIndex; i <= endIndex; i++) {
            const checkbox = $('.app-checkbox').eq(i);
            checkbox.prop('checked', $(this).is(':checked'));
            // activate row
            if ($(checkbox).is(':checked'))
                $(checkbox).closest('tr').addClass('active');
            else
                $(checkbox).closest('tr').removeClass('active');
        }
    }

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

    // store the index of the last clicked checkbox
    window.last_clicked_app_checkbox_index = $('.app-checkbox').index(this);
})

function remove_app_card(app_uid, callback = null) {
    $(`.app-card[data-uid="${app_uid}"]`).fadeOut(200, function() {
        $(this).remove();
        if ($(`.app-card`).length === 0) {
            $('section:not(.sidebar)').hide();
            $('#no-apps-notice').show();
        } else {
            $('section:not(.sidebar)').hide();
            $('#app-list').show();
        }

        // update select-all-apps checkbox's state
        if($('.app-checkbox:checked').length === 0){
            $('.select-all-apps').prop('indeterminate', false);
            $('.select-all-apps').prop('checked', false);
        }
        else if($('.app-checkbox:checked').length === $('.app-card').length){
            $('.select-all-apps').prop('indeterminate', false);
            $('.select-all-apps').prop('checked', true);
        }
        else{
            $('.select-all-apps').prop('indeterminate', true);
        }

        count_apps();
        if (callback) callback();
    });
}

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
        // show 'deleting' modal
        puter.ui.showSpinner();

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
            remove_app_card(app_uid);

            try{
                // get app directory
                const stat = await puter.fs.stat({
                    path: `/${auth_username}/AppData/${dev_center_uid}/${app_uid}`,
                    returnSubdomains: true
                });
                // delete subdomain associated with the app directory
                if(stat?.subdomains[0]?.subdomain){
                        await puter.hosting.delete(stat.subdomains[0].subdomain)
                }
                // delete app directory
                await puter.fs.delete(
                    `/${auth_username}/AppData/${dev_center_uid}/${app_uid}`,
                    { recursive: true }
                )
                count_apps();
            } catch(err) {
                console.log(err);
            }
        }

        // close 'deleting' modal
        setTimeout(() => {
            puter.ui.hideSpinner();
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


window.initializeAssetsDirectory = async () => {
    try {
        // Check if assets_url exists
        const existingURL = await puter.kv.get('assets_url');
        if (!existingURL) {
            // Create assets directory
            const assetsDir = await puter.fs.mkdir(
                `/${auth_username}/AppData/${dev_center_uid}/assets`,
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

window.generateSocialImageSection = (app) => {
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

window.handleSocialImageUpload = async (app_name, socialImageData) => {
    if (!socialImageData) return null;

    try {
        const assets_url = await puter.kv.get('assets_url');
        if (!assets_url) throw new Error('Assets URL not found');

        // Convert base64 to blob
        const base64Response = await fetch(socialImageData);
        const blob = await base64Response.blob();

        // Get assets directory path
        const assetsDir = `/${auth_username}/AppData/${dev_center_uid}/assets`;
        
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
    let period = $(this).val();
    render_analytics(period);
});

async function render_analytics(period){
    puter.ui.showSpinner();

    // set a sensible stats_grouping based on the selected period
    let stats_grouping;

    if (period === 'today' || period === 'yesterday') {
        stats_grouping = 'hour';
    }
    else if (period === 'this_week' || period === 'last_week' || period === 'this_month' || period === 'last_month' || period === '7d' || period === '30d') {
        stats_grouping = 'day';
    }
    else if (period === 'this_year' || period === 'last_year' || period === '12m' || period === 'all') {
        stats_grouping = 'month';
    }

    const app = await puter.apps.get(
        currently_editing_app.name, 
        { 
            icon_size: 16, 
            stats_period: period,
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
    const labels = app.stats.grouped_stats.open_count.map(item => {
        let date;
        if (stats_grouping === 'month') {
            // Handle YYYY-MM format explicitly
            const [year, month] = item.period.split('-');
            date = new Date(parseInt(year), parseInt(month) - 1); // month is 0-based in JS
        } else {
            date = new Date(item.period);
        }
        
        if (stats_grouping === 'hour') {
            return date.toLocaleString('en-US', { hour: 'numeric', hour12: true }).toLowerCase();
        } else if (stats_grouping === 'day') {
            return date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
        } else {
            return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        }
    });
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
                    borderColor: '#346beb',
                    tension: 0,
                    fill: false
                },
                {
                    label: 'Users',
                    data: userData,
                    borderColor: '#27cc32',
                    tension: 0,
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
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Count'
                    },
                    ticks: {
                        precision: 0,  // Show whole numbers only
                        stepSize: 1    // Increment by 1
                    }
                }
            },
        }
    });

    puter.ui.hideSpinner();
}

$(document).on('click', '.stats-cell', function(e) {
    edit_app_section($(this).attr('data-app-name'), 'analytics');
})

function app_context_menu(app_name, app_title, app_uid) {
    puter.ui.contextMenu({
        items: [
            {
                label: 'Open App',
                type: 'primary',
                action: () => {
                    puter.ui.launchApp(app_name);
                },
            },
            '-',
            {
                label: 'Edit',
                type: 'primary',
                action: () => {                
                    edit_app_section(app_name);
                },
            },
            {
                label: 'Add Shortcut to Desktop',
                type: 'primary',
                action: () => {
                    puter.fs.upload(
                        new File([], app_title),
                        `/${auth_username}/Desktop`,
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
                
                },
            },
            '-',
            {
                label: 'Delete',
                type: 'danger',
                action: () => {
                    attempt_delete_app(app_name, app_title, app_uid);
                },
            },
        ],
    });

}
$(document).on('click', '.options-icon-app', function(e) {
    let app_name = $(this).attr('data-app-name');
    let app_title = $(this).attr('data-app-title');
    let app_uid = $(this).attr('data-app-uid');

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    app_context_menu(app_name, app_title, app_uid);
})

async function attempt_delete_app(app_name, app_title, app_uid) {
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
        remove_app_card(app_uid);

        // delete app
        puter.apps.delete(app_name).then(async (app) => {
                // get app directory
                puter.fs.stat({
                    path: `/${auth_username}/AppData/${dev_center_uid}/${app_uid}`,
                    returnSubdomains: true,
                }).then(async (stat) => {
                    // delete subdomain associated with the app dir
                    puter.hosting.delete(stat.subdomains[0].subdomain)
                    // delete app directory
                    puter.fs.delete(
                        `/${auth_username}/AppData/${dev_center_uid}/${app_uid}`,
                        { recursive: true }
                    )
                })
            }).catch(async (err) => {
                    puter.ui.hideSpinner();
                    puter.ui.alert(err?.message, [
                        {
                            label: 'Ok',
                        },
                    ]);
            })
    }

}

export default init_apps;