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

import init_apps from './apps.js';
import init_workers from './workers.js';
import init_websites from './websites.js';
import { showTabLoading, hideTabLoading } from './loading.js';

window.url_params = new URLSearchParams(window.location.search);
window.domain = 'puter.com'
window.auth_username = null;
window.dev_center_uid = puter.appID;
window.developer;
window.activeTab = 'apps';
window.user = null;

const EARN_MONEY_KV_KEY = 'earn-money-c2a-closed';
const earnMoneyDialog = document.getElementById('earn-money');
const earnMoneyCTAButton = document.querySelector('.sidebar-earn-money');
const sidebarEl = document.querySelector('.sidebar');
const sidebarOverlay = document.querySelector('.sidebar-overlay');
const sidebarMobileToggle = document.querySelector('.sidebar-mobile-toggle');
const sidebarToggleButtons = document.querySelectorAll('.sidebar-toggle');
const mobileSidebarQuery = window.matchMedia('(max-width: 840px)');
let hasMarkedEarnMoneyDismissed = false;

const isKVTruthy = (value) => value === true || value === 'true' || value?.result === true;

const updateSidebarAria = (open) => {
    const label = open ? 'Collapse navigation' : 'Open navigation';
    const toggleButtons = document.querySelectorAll('.sidebar-toggle, .sidebar-mobile-toggle');
    toggleButtons.forEach((btn) => {
        if (btn) btn.setAttribute('aria-label', label);
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    if (!sidebarEl) return;

    if (mobileSidebarQuery.matches) {
        sidebarEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    } else {
        sidebarEl.removeAttribute('aria-hidden');
    }
};

const setSidebarState = (open) => {
    if (!sidebarEl) return;

    if (open) {
        sidebarEl.classList.add('open');
        document.body.classList.add('sidebar-open');

        if (mobileSidebarQuery.matches) {
            if (sidebarOverlay) {
                sidebarOverlay.hidden = false;
                requestAnimationFrame(() => sidebarOverlay.classList.add('visible'));
            }
        } else if (sidebarOverlay) {
            sidebarOverlay.classList.remove('visible');
            sidebarOverlay.hidden = true;
        }
    } else {
        sidebarEl.classList.remove('open');
        document.body.classList.remove('sidebar-open');

        if (sidebarOverlay) {
            sidebarOverlay.classList.remove('visible');
            sidebarOverlay.hidden = true;
        }
    }

    updateSidebarAria(open);
};

const toggleSidebar = (forceOpen = null) => {
    if (!sidebarEl) return;
    const shouldOpen = forceOpen !== null ? forceOpen : !sidebarEl.classList.contains('open');
    setSidebarState(shouldOpen);
};

const refreshSidebarForViewport = () => {
    if (!sidebarEl) return;
    if (mobileSidebarQuery.matches) {
        setSidebarState(false);
    } else {
        setSidebarState(true);
    }
};

sidebarToggleButtons.forEach((btn) => {
    btn?.addEventListener('click', () => toggleSidebar());
});

if (sidebarMobileToggle) {
    sidebarMobileToggle.addEventListener('click', () => toggleSidebar(true));
}

if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => toggleSidebar(false));
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && mobileSidebarQuery.matches && sidebarEl?.classList.contains('open')) {
        toggleSidebar(false);
    }
});

const registerMediaQuery = () => {
    if (typeof mobileSidebarQuery.addEventListener === 'function') {
        mobileSidebarQuery.addEventListener('change', refreshSidebarForViewport);
    } else if (typeof mobileSidebarQuery.addListener === 'function') {
        mobileSidebarQuery.addListener(refreshSidebarForViewport);
    }
};

registerMediaQuery();
refreshSidebarForViewport();

window.showEarnMoneyCTA = () => {
    if (earnMoneyCTAButton) earnMoneyCTAButton.removeAttribute('hidden');
};

const persistEarnMoneyDismissal = async () => {
    window.showEarnMoneyCTA();
    if (hasMarkedEarnMoneyDismissed) return;
    hasMarkedEarnMoneyDismissed = true;
    try {
        await puter?.kv?.set?.(EARN_MONEY_KV_KEY, 'true');
    } catch (err) {
        console.warn('Unable to persist earn-money dismissal', err);
    }
};

const ensureEarnMoneyCTAState = async () => {
    if (!earnMoneyCTAButton || typeof puter?.kv?.get !== 'function') {
        return;
    }
    try {
        const kvValue = await puter.kv.get(EARN_MONEY_KV_KEY);
        if (isKVTruthy(kvValue)) {
            hasMarkedEarnMoneyDismissed = true;
            window.showEarnMoneyCTA();
        }
    } catch (err) {
        console.warn('Unable to read earn-money dismissal state', err);
    }
};

const openEarnMoneyDialog = () => {
    if (!earnMoneyDialog) return;
    earnMoneyDialog.removeAttribute('style');
    try {
        earnMoneyDialog.showModal();
    } catch (err) {
        console.warn('Unable to open earn-money dialog', err);
    }
};
window.openEarnMoneyDialog = openEarnMoneyDialog;

if (earnMoneyDialog) {
    earnMoneyDialog.addEventListener('close', () => {
        persistEarnMoneyDismissal();
    });

    earnMoneyDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        earnMoneyDialog.close();
    });

    earnMoneyDialog.addEventListener('click', (event) => {
        const dialogRect = earnMoneyDialog.getBoundingClientRect();
        const clickedInside =
            event.clientX >= dialogRect.left &&
            event.clientX <= dialogRect.right &&
            event.clientY >= dialogRect.top &&
            event.clientY <= dialogRect.bottom;

        if (!clickedInside) {
            earnMoneyDialog.close();
        }
    });

    const earnMoneyCloseBtn = document.getElementById('earn-money-c2a-close');
    if (earnMoneyCloseBtn) {
        earnMoneyCloseBtn.addEventListener('click', () => {
            earnMoneyDialog.close();
        });
    }
}

if (earnMoneyCTAButton && earnMoneyDialog) {
    earnMoneyCTAButton.addEventListener('click', () => {
        earnMoneyCTAButton.setAttribute('hidden', '');
        openEarnMoneyDialog();
    });
}

ensureEarnMoneyCTAState();

// auth_username
(async () => {
    window.user = await puter.auth.getUser();

    if (user?.username) {
        window.auth_username = user.username;
    }
})()

// domain and APIOrigin
if (window.url_params.has('puter.domain')) {
    window.domain = window.url_params.get('puter.domain')
}

// static hosting domain
window.static_hosting_domain = 'puter.site';
if(window.domain === 'puter.localhost'){
    window.static_hosting_domain = 'site.puter.localhost';
}

// add port to static_hosting_domain if provided
if (window.url_params.has('puter.port') && window.url_params.get('puter.port')) {
    window.static_hosting_domain = window.static_hosting_domain + `:` + html_encode(window.url_params.get('puter.port'));
}

// protocol
window.protocol = 'https';
if (window.url_params.has('puter.protocol') && window.url_params.get('puter.protocol') === 'http')
    window.protocol = 'http';

// port
window.port = '';
if (window.url_params.has('puter.port') && window.url_params.get('puter.port')) {
    window.port = html_encode(window.url_params.get('puter.port'));
}

// source_path
if (window.url_params.has('source_path')) {
    window.source_path = window.url_params.get('source_path');
} else {
    window.source_path = null;
}

// ---------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------
$(document).ready(async function () {
    // initialize assets directory
    await initializeAssetsDirectory();

    init_apps();
    init_websites();
    init_workers();
});

// ---------------------------------------------------------------
// Tab Buttons
// ---------------------------------------------------------------
$(document).on('click', '.tab-btn', async function (e) {
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
        // Reset apps search when tab is activated
        resetAppsSearch();
    }
    // ---------------------------------------------------------------
    // Workers tab
    // ---------------------------------------------------------------
    else if ($(this).attr('data-tab') === 'workers') {
        refresh_worker_list();
        activeTab = 'workers';
        // Reset workers search when tab is activated
        resetWorkersSearch();
    }
    // ---------------------------------------------------------------
    // Websites tab
    // ---------------------------------------------------------------
    else if ($(this).attr('data-tab') === 'websites') {
        refresh_websites_list();
        activeTab = 'websites';
        // Reset websites search when tab is activated
        resetWebsitesSearch();
    }
    // ---------------------------------------------------------------
    // Payout Method tab
    // ---------------------------------------------------------------
    else if ($(this).attr('data-tab') === 'payout-method') {
        activeTab = 'payout-method';
        showTabLoading('payout-method');
        setTimeout(function () {
            const finishLoading = () => {
                if (activeTab === 'payout-method') {
                    $('#tab-payout-method').show();
                }
                hideTabLoading('payout-method');
            };
            try {
                puter.apps.getDeveloperProfile(function (dev_profile) {
                    try {
                        if (dev_profile?.joined_incentive_program) {
                            $('#payout-method-email').html(dev_profile.paypal);
                        }
                    } catch (callbackError) {
                        console.error('Error updating payout method UI:', callbackError);
                    } finally {
                        finishLoading();
                    }
                });
            } catch (error) {
                console.error('Error loading payout method profile:', error);
                finishLoading();
            }
        }, 1000);
    }
})

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
            // show separator
            $('.tab-btn-separator').show();
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

$('#earn-money-c2a-close').on('click', function () {
    earnMoneyDialog?.close();
});

// https://stackoverflow.com/a/43467144/1764493
window.is_valid_url = (string) => {
    let url;

    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }

    return url.protocol === "http:" || url.protocol === "https:";
}

window.getBase64ImageFromUrl = async (imageUrl) => {
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
window.validateEmail = (email) => {
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
window.number_format = (number, decimals, dec_point, thousands_sep) => {
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

$(document).on('click', '.section-tab-btn', function (e) {
    // hide all tabs
    $('.section-tab').hide();
    // show section
    $(`.section-tab[data-tab="${$(this).attr('data-tab')}"]`).show();
    // remove active class from all tab buttons
    $('.section-tab-btn').removeClass('active');
    // add active class to clicked tab button
    $(this).addClass('active');
})

$(document).on('click', '.close-success-msg', function (e) {
    $(this).closest('div').fadeOut();
})

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
        window.dropped_items = event.detail.items;
        window.source_path = window.dropped_items[0].path;
        // by deploying an existing Puter folder. So we create the app and deploy it.
        if (window.source_path) {
            // todo if there are no apps, go straight to creating a new app
            $('.insta-deploy-modal').get(0).showModal();
            // set item name
            $('.insta-deploy-item-name').html(html_encode(window.dropped_items[0].name));
        }
    }
    //-----------------------------------------------------------------------------
    // Local items dropped
    //-----------------------------------------------------------------------------
    const e = event.originalEvent;
    if (!e.dataTransfer || !e.dataTransfer.items || e.dataTransfer.items.length === 0)
        return;

    // Get dropped items
    window.dropped_items = await puter.ui.getEntriesFromDataTransferItems(e.dataTransfer.items);

    // Generate a flat array of full paths from the dropped items
    let paths = [];
    for (let item of window.dropped_items) {
        paths.push('/' + (item.fullPath ?? item.filepath));
    }

    // Generate a directory tree from the paths
    let tree = generateDirTree(paths);

    window.dropped_items = setRootDirTree(tree, window.dropped_items);

    // Alert if no index.html in root
    if (!hasRootIndexHtml(tree)) {
        puter.ui.alert(index_missing_error, [
            {
                label: 'Ok',
            },
        ]);
        $('.drop-area').removeClass('drop-area-ready-to-deploy');
        $('.deploy-btn').addClass('disabled');
        window.dropped_items = [];
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

/**
 * Get the MIME type for a given file extension.
 *
 * @param {string} extension - The file extension (with or without leading dot).
 * @returns {string} The corresponding MIME type, or 'application/octet-stream' if not found.
 */
window.getMimeType = (extension) => {
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

// ---------------------------------------------------------------
// Search Reset Functions
// ---------------------------------------------------------------
window.resetAppsSearch = () => {
    $('.search-apps').val('');
    $('.search-clear-apps').hide();
    $('.search-apps').removeClass('has-value');
    // Reset search query in apps.js scope if search_apps function is available
    if (typeof search_apps === 'function') {
        search_apps();
    }
}

window.resetWorkersSearch = () => {
    $('.search-workers').val('');
    $('.search-clear-workers').hide();
    $('.search-workers').removeClass('has-value');
    // Reset search query in workers.js scope if search_workers function is available
    if (typeof search_workers === 'function') {
        search_workers();
    }
}

window.resetWebsitesSearch = () => {
    $('.search-websites').val('');
    $('.search-clear-websites').hide();
    $('.search-websites').removeClass('has-value');
    // Reset search query in websites.js scope if search_websites function is available
    if (typeof search_websites === 'function') {
        search_websites();
    }
}

window.activate_tippy = () => {
    tippy('.tippy', {
        content(reference) {
            return reference.getAttribute('title');
        },
        onMount(instance) {
            // Remove the default title to prevent double tooltips
            instance.reference.removeAttribute('title');
        },
        placement: 'top',
        arrow: true,
    });  
}
