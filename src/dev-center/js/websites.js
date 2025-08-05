let sortBy = 'created_at';
let sortDirection = 'desc';
window.websites = [];
let search_query;

window.create_website = async (name, directoryPath = null) => {
    let website
    
    // Use provided directory path or default to the default website file
    const websiteDir = directoryPath || window.default_website_file;
    
    try {
        website = await puter.hosting.create(name, websiteDir);
    } catch (error) {
        puter.ui.alert(`Error creating website: ${error.error.message}`);
    }

    return website;
}

window.refresh_websites_list = async (show_loading = false) => {
    if (show_loading)
        puter.ui.showSpinner();

    // puter.hosting.list() returns an array of website objects
    window.websites = await puter.hosting.list();

    // Get websites
    if (window.activeTab === 'websites' && window.websites.length > 0) {
        $('.website-card').remove();
        $('#no-websites-notice').hide();
        $('#website-list').show();
        window.websites.forEach((website) => {
            // append row to website-list-table
            $('#website-list-table > tbody').append(generate_website_card(website));
        });
    } else {
        $('#no-websites-notice').show();
        $('#website-list').hide();
    }

    count_websites();
}


async function init_websites() {
    puter.hosting.list().then((websites) => {
        window.websites = websites;
        count_websites();
    });
}

$(document).on('click', '.create-a-website-btn', async function (e) {
    // Step 1: Show directory picker
    let selectedDirectory;
    try {
        selectedDirectory = await puter.ui.showDirectoryPicker();
    } catch (err) {
        // User cancelled directory picker or there was an error
        console.log('Directory picker cancelled or error:', err);
        return;
    }

    // Step 2: Ask for website name
    if (selectedDirectory && selectedDirectory.path) {
        let name = await puter.ui.prompt('Please enter a name for your website:', 'my-awesome-website');

        // Step 3: Create website with selected directory
        if (name) {
            await create_website(name, selectedDirectory.path);
            refresh_websites_list();
        }
    }
})

$(document).on('change', '.website-checkbox', function (e) {
    // determine if select-all checkbox should be checked, indeterminate, or unchecked
    if ($('.website-checkbox:checked').length === $('.website-checkbox').length) {
        $('.select-all-websites').prop('indeterminate', false);
        $('.select-all-websites').prop('checked', true);
    } else if ($('.website-checkbox:checked').length > 0) {
        $('.select-all-websites').prop('indeterminate', true);
        $('.select-all-websites').prop('checked', false);
    }
    else {
        $('.select-all-websites').prop('indeterminate', false);
        $('.select-all-websites').prop('checked', false);
    }

    // activate row
    if ($(this).is(':checked'))
        $(this).closest('tr').addClass('active');
    else
        $(this).closest('tr').removeClass('active');

    // enable delete button if at least one checkbox is checked
    if ($('.website-checkbox:checked').length > 0)
        $('.delete-websites-btn').removeClass('disabled');
    else
        $('.delete-websites-btn').addClass('disabled');
})

$(document).on('change', '.select-all-websites', function (e) {
    if ($(this).is(':checked')) {
        $('.website-checkbox').prop('checked', true);
        $('.website-card').addClass('active');
        $('.delete-websites-btn').removeClass('disabled');
    } else {
        $('.website-checkbox').prop('checked', false);
        $('.website-card').removeClass('active');
        $('.delete-websites-btn').addClass('disabled');
    }
})

$('.refresh-website-list').on('click', function (e) {
    puter.ui.showSpinner();
    refresh_websites_list();

    puter.ui.hideSpinner();
})

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
    $('#website-list-table').find('th').removeClass('sorted');
    $(this).find('.sort-arrow-' + sortDirection).css('display', 'inline');
    $(this).addClass('sorted');

    sort_websites();
});

function sort_websites() {
    let sorted_websites;

    // sort
    if (sortDirection === 'asc'){
        sorted_websites = websites.sort((a, b) => {
            if(sortBy === 'name'){
                return a.subdomain.localeCompare(b.subdomain);
            }else if(sortBy === 'created_at'){
                return new Date(a[sortBy]) - new Date(b[sortBy]);
            } else if(sortBy === 'user_count' || sortBy === 'open_count'){
                return a.stats[sortBy] - b.stats[sortBy];
            } else if(sortBy === 'root_dir'){
                const aRootDir = a.root_dir?.name || '';
                const bRootDir = b.root_dir?.name || '';
                return aRootDir.localeCompare(bRootDir);
            }else{
                return a[sortBy] > b[sortBy] ? 1 : -1;
            }
        });
    }else{
        sorted_websites = websites.sort((a, b) => {
            if(sortBy === 'name'){
                return b.subdomain.localeCompare(a.subdomain);
            }else if(sortBy === 'created_at'){
                return new Date(b[sortBy]) - new Date(a[sortBy]);
            } else if(sortBy === 'user_count' || sortBy === 'open_count'){
                return b.stats[sortBy] - a.stats[sortBy];
            } else if(sortBy === 'root_dir'){
                const aRootDir = a.root_dir?.name || '';
                const bRootDir = b.root_dir?.name || '';
                return bRootDir.localeCompare(aRootDir);
            }else{
                return b[sortBy] > a[sortBy] ? 1 : -1;
            }
        });
    }
    // refresh website list
    $('.website-card').remove();
    sorted_websites.forEach(website => {
        $('#website-list-table > tbody').append(generate_website_card(website));
    });

    count_websites();

    // show websites that match search_query and hide websites that don't
    if (search_query) {
        // show websites that match search_query and hide websites that don't
        websites.forEach((website) => {
            if (website.subdomain.toLowerCase().includes(search_query.toLowerCase())) {
                $(`.website-card[data-name="${html_encode(website.subdomain)}"]`).show();
            } else {
                $(`.website-card[data-name="${html_encode(website.subdomain)}"]`).hide();
            }
        })
    }
}

function count_websites() {
    let count = window.websites.length;
    $('.website-count').html(count ? count : '');
    return count;
}

function generate_website_card(website) {
    return `
        <tr class="website-card" data-name="${html_encode(website.subdomain)}">
            <td style="width:30px; vertical-align: middle; line-height: 1;">
                <input type="checkbox" class="website-checkbox" data-website-name="${website.subdomain}">
            </td>
            <td style="font-family: monospace; font-size: 14px; vertical-align: middle;"><a href="https://${website.subdomain}.puter.site" target="_blank">${website.subdomain}.puter.site</a></td>
            <td style="font-size: 14px; vertical-align: middle;"> <span class="root-dir-name" data-root-dir-path="${website.root_dir ? html_encode(website.root_dir.path) : ''}">${website.root_dir ? website.root_dir.name : ''}</span></td>
            <td style="font-size: 14px; vertical-align: middle;">${website.created_at}</td>
            <td style="vertical-align: middle;"><img class="options-icon options-icon-website" data-website-name="${website.subdomain}" src="./img/options.svg"></td>
        </tr>
    `;
}

$(document).on('input change keyup keypress keydown paste cut', '.search-websites', function (e) {
    search_websites();
})

window.search_websites = function() {
    // search websites for query
    search_query = $('.search-websites').val().toLowerCase();
    if (search_query === '') {
        // hide 'clear search' button
        $('.search-clear-websites').hide();
        // show all websites again
        $(`.website-card`).show();
        // remove 'has-value' class from search input
        $('.search-websites').removeClass('has-value');
    } else {
        // show 'clear search' button
        $('.search-clear-websites').show();
        // show websites that match search_query and hide websites that don't
        websites.forEach((website) => {
            if (
                website.subdomain.toLowerCase().includes(search_query.toLowerCase()) ||
                website.root_dir?.name?.toLowerCase().includes(search_query.toLowerCase())
            )
            {
                $(`.website-card[data-name="${website.subdomain}"]`).show();
            } else {
                $(`.website-card[data-name="${website.subdomain}"]`).hide();
            }
        })

        // add 'has-value' class to search input
        $('.search-websites').addClass('has-value');
    }
}

$(document).on('click', '.search-clear-websites', function (e) {
    $('.search-websites').val('');
    $('.search-websites').trigger('change');
    $('.search-websites').focus();
    search_query = '';
    // remove 'has-value' class from search input
    $('.search-websites').removeClass('has-value');
})

$(document).on('click', '.delete-websites-btn', async function (e) {
    // show confirmation alert
    let resp = await puter.ui.alert(`Are you sure you want to delete the selected websites?`, [
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
        $('.delete-websites-btn').addClass('disabled');

        // show 'deleting' modal
        puter.ui.showSpinner();

        let start_ts = Date.now();
        const websites = $('.website-checkbox:checked').toArray();

        // delete all checked websites
        for (let website of websites) {
            let website_name = $(website).attr('data-website-name');
            // delete website
            await puter.hosting.delete(website_name)

            // remove website card
            $(`.website-card[data-name="${website_name}"]`).fadeOut(200, function name(params) {
                $(this).remove();
                if ($(`.website-card`).length === 0) {
                    $('section:not(.sidebar)').hide();
                    $('#no-websites-notice').show();
                } else {
                    $('section:not(.sidebar)').hide();
                    $('#website-list').show();
                }
                count_websites();
            });

            try{
                count_websites();
            } catch(err) {
                console.log(err);
            }
        }

        // close 'deleting' modal
        setTimeout(() => {
            puter.ui.hideSpinner();
            if($('.website-checkbox:checked').length === 0){
                // disable delete button
                $('.delete-websites-btn').addClass('disabled');
                // reset the 'select all' checkbox
                $('.select-all-websites').prop('indeterminate', false);
                $('.select-all-websites').prop('checked', false);
            }
        }, (start_ts - Date.now()) > 500 ? 0 : 500);
    }
})

$(document).on('click', '.options-icon-website', function (e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    puter.ui.contextMenu({
        items: [
            {
                label: 'Change Directory',
                action: () => {
                    change_website_directory($(this).attr('data-website-name'));
                },
            },
            {
                label: 'Delete',
                type: 'danger',
                action: () => {
                    attempt_delete_website($(this).attr('data-website-name'));
                },
            },
        ],
    });
})

async function attempt_delete_website(website_name) {
    // confirm delete
    const alert_resp = await puter.ui.alert(`Are you sure you want to premanently delete <strong>${html_encode(website_name)}.puter.site</strong>?`,
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
        // remove website card and update website count
        $(`.website-card[data-name="${website_name}"]`).fadeOut(200, function name(params) {
            $(this).remove();
            if ($(`.website-card`).length === 0) {
                $('section:not(.sidebar)').hide();
                $('#no-websites-notice').show();
            } else {
                $('section:not(.sidebar)').hide();
                $('#website-list').show();
            }
            count_websites();
        });

        // delete website
        puter.hosting.delete(website_name);
    }
}

async function change_website_directory(website_name) {
    try {
        // Step 1: Show directory picker
        const selectedDirectory = await puter.ui.showDirectoryPicker();
        
        if (!selectedDirectory || !selectedDirectory.path) {
            return; // User cancelled
        }

        // Step 2: Confirm the change since it will replace the current website
        const confirmResp = await puter.ui.alert(
            `Are you sure you want to change the directory for <strong>${html_encode(website_name)}.puter.site</strong>?<br><br>This will update the website to serve files from the new directory.`,
            [
                {
                    label: 'Yes, change directory',
                    value: 'change',
                    type: 'primary',
                },
                {
                    label: 'Cancel'
                },
            ],
            {
                type: 'info',
            }
        );

        if (confirmResp !== 'change') {
            return;
        }

        // Step 3: Show loading spinner
        puter.ui.showSpinner();

        try {
            // Step 4: Delete the existing website
            await puter.hosting.delete(website_name);

            // Step 5: Create a new website with the same name but new directory
            await puter.hosting.create(website_name, selectedDirectory.path);

            // Step 6: Refresh the websites list to show the updated directory
            await refresh_websites_list();

            // Step 7: Show success message
            puter.ui.alert(`Website directory changed successfully! <strong>${html_encode(website_name)}.puter.site</strong> now serves files from the new directory.`, [], {
                type: 'success',
            });

        } catch (error) {
            // If there's an error, show error message
            puter.ui.alert(`Error changing website directory: ${error.error?.message || error.message || 'Unknown error'}`, [], {
                type: 'error',
            });
        } finally {
            // Hide loading spinner
            puter.ui.hideSpinner();
        }

    } catch (error) {
        // Handle directory picker error
        console.log('Directory picker cancelled or error:', error);
    }
}

$(document).on('click', '.root-dir-name', function (e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    const root_dir_path = $(this).attr('data-root-dir-path');

    if(root_dir_path){
        puter.ui.launchApp('explorer', {
            path: root_dir_path,
        });
    }
})
export default init_websites;