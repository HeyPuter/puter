import { showTabLoading, hideTabLoading } from './loading.js';

let sortBy = 'created_at';
let sortDirection = 'desc';
window.workers = [];
let search_query;

window.create_worker = async (name, filePath = null) => {
    let worker;
    
    // show spinner
    puter.ui.showSpinner();

    // Use provided file path or default to the default worker file
    const workerFile = filePath;
    
    try {
        worker = await puter.workers.create(name, workerFile);
    } catch (err) {
        puter.ui.alert(`Error creating worker: ${err.error?.message}`);
    }

    return worker;
}

window.refresh_worker_list = async ({ manageSkeleton = true } = {}) => {
    if (manageSkeleton) {
        showTabLoading('workers');
    }

    try {
        window.workers = await puter.workers.list();

        if (window.activeTab === 'workers' && window.workers.length > 0) {
            $('.worker-card').remove();
            $('#no-workers-notice').hide();
            $('#worker-list').show();
            window.workers.forEach((worker) => {
                $('#worker-list-table > tbody').append(generate_worker_card(worker));
            });
        } else {
            $('.worker-card').remove();
            $('#no-workers-notice').show();
            $('#worker-list').hide();
        }

        count_workers();
    } catch (err) {
        console.error('Error refreshing worker list:', err);
    } finally {
        if (manageSkeleton) {
            hideTabLoading('workers');
        }
    }
};


async function init_workers() {
    window.workers = await puter.workers.list();
    count_workers();
}

$(document).on('click', '.create-a-worker-btn', async function (e) {
    // if user doesn't have an email, request it
    if(!window.user?.email || !window.user?.email_confirmed){
        const email_confirm_resp = await puter.ui.requestEmailConfirmation();
        if(!email_confirm_resp)
            UIAlert('Email confirmation required to create a worker.');
            return;
    }

    // refresh user data
    window.user = await puter.auth.getUser();

    // Step 1: Show file picker limited to .js files
    let selectedFile;
    try {
        selectedFile = await puter.ui.showOpenFilePicker({
            accept: ".js",
        });
    } catch (err) {
        // User cancelled file picker or there was an error
        console.log('File picker cancelled or error:', err);
        return;
    }

    // Step 2: Ask for worker name
    if (selectedFile && selectedFile.path) {
        let name = await puter.ui.prompt('Please enter a name for your worker:', 'my-awesome-worker');

        // Step 3: Create worker with selected file
        if (name) {
            await create_worker(name, selectedFile.path);
            // Refresh the worker list to show the new worker
            await refresh_worker_list();

            // hide spinner
            puter.ui.hideSpinner();
        }
    }
})

$(document).on('click', '.worker-checkbox', function (e) {
    // was shift key pressed?
    if (e.originalEvent && e.originalEvent.shiftKey) {
        // select all checkboxes in range
        const currentIndex = $('.worker-checkbox').index(this);
        const startIndex = Math.min(window.last_clicked_worker_checkbox_index, currentIndex);
        const endIndex = Math.max(window.last_clicked_worker_checkbox_index, currentIndex);

        // set all checkboxes in range to the same state as current checkbox
        for (let i = startIndex; i <= endIndex; i++) {
            const checkbox = $('.worker-checkbox').eq(i);
            checkbox.prop('checked', $(this).is(':checked'));

            // activate row
            if ($(checkbox).is(':checked'))
                $(checkbox).closest('tr').addClass('active');
            else
                $(checkbox).closest('tr').removeClass('active');
        }
    }

    // determine if select-all checkbox should be checked, indeterminate, or unchecked
    if ($('.worker-checkbox:checked').length === $('.worker-checkbox').length) {
        $('.select-all-workers').prop('indeterminate', false);
        $('.select-all-workers').prop('checked', true);
    } else if ($('.worker-checkbox:checked').length > 0) {
        $('.select-all-workers').prop('indeterminate', true);
        $('.select-all-workers').prop('checked', false);
    }
    else {
        $('.select-all-workers').prop('indeterminate', false);
        $('.select-all-workers').prop('checked', false);
    }

    // activate row
    if ($(this).is(':checked'))
        $(this).closest('tr').addClass('active');
    else
        $(this).closest('tr').removeClass('active');

    // enable delete button if at least one checkbox is checked
    if ($('.worker-checkbox:checked').length > 0)
        $('.delete-workers-btn').removeClass('disabled');
    else
        $('.delete-workers-btn').addClass('disabled');

    // store the index of the last clicked checkbox
    window.last_clicked_worker_checkbox_index = $('.worker-checkbox').index(this);
})

$(document).on('change', '.select-all-workers', function (e) {
    if ($(this).is(':checked')) {
        $('.worker-checkbox').prop('checked', true);
        $('.worker-card').addClass('active');
        $('.delete-workers-btn').removeClass('disabled');
    } else {
        $('.worker-checkbox').prop('checked', false);
        $('.worker-card').removeClass('active');
        $('.delete-workers-btn').addClass('disabled');
    }
})

$('.refresh-worker-list').on('click', async function (e) {
    await refresh_worker_list();
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
    $('#worker-list-table').find('th').removeClass('sorted');
    $(this).find('.sort-arrow-' + sortDirection).css('display', 'inline');
    $(this).addClass('sorted');

    sort_workers();
});

function sort_workers() {
    let sorted_workers;

    // sort
    if (sortDirection === 'asc'){
        sorted_workers = workers.sort((a, b) => {
            if(sortBy === 'name'){
                return a[sortBy].localeCompare(b[sortBy]);
            }else if(sortBy === 'created_at'){
                return new Date(a[sortBy]) - new Date(b[sortBy]);
            }else if(sortBy === 'file_path'){
                return a[sortBy].localeCompare(b[sortBy]);
            }
            else{
                a[sortBy] > b[sortBy] ? 1 : -1
            }
        });
    }else{
        sorted_workers = workers.sort((a, b) => {
            if(sortBy === 'name'){
                return b[sortBy].localeCompare(a[sortBy]);
            }else if(sortBy === 'created_at'){
                return new Date(b[sortBy]) - new Date(a[sortBy]);
            }else if(sortBy === 'file_path'){
                return b[sortBy].localeCompare(a[sortBy]);
            } else{
                b[sortBy] > a[sortBy] ? 1 : -1
            }
        });
    }
    // refresh worker list
    $('.worker-card').remove();
    sorted_workers.forEach(worker => {
        $('#worker-list-table > tbody').append(generate_worker_card(worker));
    });

    count_workers();

    // show workers that match search_query and hide workers that don't
    if (search_query) {
        // show workers that match search_query and hide workers that don't
        workers.forEach((worker) => {
            if (worker.name.toLowerCase().includes(search_query.toLowerCase())) {
                $(`.worker-card[data-name="${html_encode(worker.name)}"]`).show();
            } else {
                $(`.worker-card[data-name="${html_encode(worker.name)}"]`).hide();
            }
        })
    }
}

function count_workers() {
    let count = window.workers.length;
    $('.worker-count').html(count ? count : '');
    return count;
}

function generate_worker_card(worker) {
    const workerPath = worker.file_path ? html_encode(worker.file_path) : '';
    return `
        <tr class="worker-card" data-name="${html_encode(worker.name)}">
            <td class="cell-select">
                <div class="checkbox-wrap">
                    <input type="checkbox" class="worker-checkbox" data-worker-name="${html_encode(worker.name)}">
                </div>
            </td>
            <td class="cell-code worker-name">${html_encode(worker.name)}</td>
            <td class="cell-code">
                <span class="worker-file-path" data-worker-file-path="${workerPath}">${workerPath}</span>
            </td>
            <td class="cell-meta">
                <span class="created-at">${html_encode(worker.created_at)}</span>
            </td>
            <td class="cell-actions">
                <img class="options-icon options-icon-worker" data-worker-name="${html_encode(worker.name)}" src="./img/options.svg" alt="Worker options">
            </td>
        </tr>
    `;
}

$(document).on('input change keyup keypress keydown paste cut', '.search-workers', function (e) {
    search_workers();
})

window.search_workers = function() {
    // search workers for query
    search_query = $('.search-workers').val().toLowerCase();
    if (search_query === '') {
        // hide 'clear search' button
        $('.search-clear-workers').hide();
        // show all workers again
        $(`.worker-card`).show();
        // remove 'has-value' class from search input
        $('.search-workers').removeClass('has-value');
    } else {
        // show 'clear search' button
        $('.search-clear-workers').show();
        // show workers that match search_query and hide workers that don't
        workers.forEach((worker) => {
            if (
                worker.name.toLowerCase().includes(search_query.toLowerCase())
            )
            {
                $(`.worker-card[data-name="${worker.name}"]`).show();
            } else {
                $(`.worker-card[data-name="${worker.name}"]`).hide();
            }
        })
        // add 'has-value' class to search input
        $('.search-workers').addClass('has-value');
    }    
}

$(document).on('click', '.search-clear-workers', function (e) {
    $('.search-workers').val('');
    $('.search-workers').trigger('change');
    $('.search-workers').focus();
    search_query = '';
    // remove 'has-value' class from search input
    $('.search-workers').removeClass('has-value');
})

function remove_worker_card(worker_name, callback = null) {
    $(`.worker-card[data-name="${worker_name}"]`).fadeOut(200, function() {
        $(this).remove();

        // Update the global workers array to remove the deleted worker
        window.workers = window.workers.filter(worker => worker.name !== worker_name);

        if ($(`.worker-card`).length === 0) {
            $('section:not(.sidebar)').hide();
            $('#no-workers-notice').show();
        } else {
            $('section:not(.sidebar)').hide();
            $('#worker-list').show();
        }

        // update select-all-workers checkbox's state
        if($('.worker-checkbox:checked').length === 0){
            $('.select-all-workers').prop('indeterminate', false);
            $('.select-all-workers').prop('checked', false);
        }
        else if($('.worker-checkbox:checked').length === $('.worker-card').length){
            $('.select-all-workers').prop('indeterminate', false);
            $('.select-all-workers').prop('checked', true);
        }
        else{
            $('.select-all-workers').prop('indeterminate', true);
        }

        count_workers();
        if (callback) callback();
    });
}

$(document).on('click', '.delete-workers-btn', async function (e) {
    // show confirmation alert
    let resp = await puter.ui.alert(`Are you sure you want to delete the selected workers?`, [
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
        $('.delete-workers-btn').addClass('disabled');

        // show 'deleting' modal
        puter.ui.showSpinner();

        let start_ts = Date.now();
        const workers = $('.worker-checkbox:checked').toArray();

        // delete all checked workers
        for (let worker of workers) {
            let worker_name = $(worker).attr('data-worker-name');
            // delete worker
            await puter.workers.delete(worker_name)

            // remove worker card
            remove_worker_card(worker_name);

            try{
                count_workers();
            } catch(err) {
                console.log(err);
            }
        }

        // close 'deleting' modal
        setTimeout(() => {
            puter.ui.hideSpinner();
            if($('.worker-checkbox:checked').length === 0){
                // disable delete button
                $('.delete-workers-btn').addClass('disabled');
                // reset the 'select all' checkbox
                $('.select-all-workers').prop('indeterminate', false);
                $('.select-all-workers').prop('checked', false);
            }
        }, (start_ts - Date.now()) > 500 ? 0 : 500);
    }
})

$(document).on('click', '.options-icon-worker', function (e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    puter.ui.contextMenu({
        items: [
            {
                label: 'Delete',
                type: 'danger',
                action: () => {
                    attempt_worker_deletion($(this).attr('data-worker-name'));
                },
            },
        ],
    });
})

async function attempt_worker_deletion(worker_name) {
    // confirm delete
    const alert_resp = await puter.ui.alert(`Are you sure you want to premanently delete <strong>${html_encode(worker_name)}</strong>?`,
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
        // remove worker card and update worker count
        remove_worker_card(worker_name);

        // delete worker
        puter.workers.delete(worker_name).then().catch(async (err) => {
            puter.ui.alert(err?.message, [
                {
                    label: 'Ok',
                },
            ]);
        })
    }
}

$(document).on('click', '.worker-file-path', function (e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    const file_path = $(this).attr('data-worker-file-path');

    if(file_path){
        puter.ui.launchApp({
            name: 'editor',
            file_paths: [file_path],
        });
    }
})

export default init_workers;
