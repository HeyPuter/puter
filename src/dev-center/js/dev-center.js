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

window.url_params = new URLSearchParams(window.location.search);
window.domain = 'puter.com'
window.auth_username = null;
window.dev_center_uid = puter.appID;
window.developer;
window.activeTab = 'apps';

// auth_username
(async () => {
    let user = await puter.auth.getUser();

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

    // create default worker file
    await createDefaultWorkerFile();

    puter.ui.showSpinner();

    init_apps();
    init_websites();
    init_workers();

    puter.ui.hideSpinner();
});

// ---------------------------------------------------------------
// Tab Buttons
// ---------------------------------------------------------------
$(document).on('click', '.tab-btn', async function (e) {
    puter.ui.showSpinner();
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
    // Workers tab
    // ---------------------------------------------------------------
    else if ($(this).attr('data-tab') === 'workers') {
        refresh_worker_list();
        activeTab = 'workers';
    }
    // ---------------------------------------------------------------
    // Websites tab
    // ---------------------------------------------------------------
    else if ($(this).attr('data-tab') === 'websites') {
        refresh_websites_list();
        activeTab = 'websites';
    }
    // ---------------------------------------------------------------
    // Payout Method tab
    // ---------------------------------------------------------------
    else if ($(this).attr('data-tab') === 'payout-method') {
        activeTab = 'payout-method';
        puter.ui.showSpinner();
        setTimeout(function () {
            puter.apps.getDeveloperProfile(function (dev_profile) {
                // show payout method tab if dev has joined incentive program
                if (dev_profile.joined_incentive_program) {
                    $('#payout-method-email').html(dev_profile.paypal);
                }
                puter.ui.hideSpinner();
                if (activeTab === 'payout-method')
                    $('#tab-payout-method').show();
            })
        }, 1000);
    }

    puter.ui.hideSpinner();
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

$('#earn-money-c2a-close').click(async function (e) {
    $('#earn-money').get(0).close();
    puter.kv.set('earn-money-c2a-closed', 'true')
})

$('#earn-money::backdrop').click(async function (e) {
    alert();
    $('#earn-money').get(0).close();
    puter.kv.set('earn-money-c2a-closed', 'true')
})

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
    $('.section-tab[data-tab="' + $(this).attr('data-tab') + '"]').show();
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

$(document).on('click', '.sidebar-toggle', function (e) {
    $('.sidebar').toggleClass('open');
    $('body').toggleClass('sidebar-open');
})

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