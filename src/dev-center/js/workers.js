let sortBy = 'created_at';
let sortDirection = 'desc';
window.workers = [];
let search_query;

window.create_worker = async (name) => {
    let worker = await puter.workers.create(name, window.default_worker_file);

    return worker;
}

window.refresh_worker_list = async (show_loading = false) => {
    if (show_loading)
        puter.ui.showSpinner();

    // puter.workers.list() returns an array of worker objects
    window.workers = await puter.workers.list();

    // Get workers
    if (window.activeTab === 'workers' && window.workers.length > 0) {
        $('.worker-card').remove();
        $('#no-workers-notice').hide();
        $('#worker-list').show();
        window.workers.forEach((worker) => {
            // append row to worker-list-table
            $('#worker-list-table > tbody').append(generate_worker_card(worker));
        });
    } else {
        $('#no-workers-notice').show();
        $('#worker-list').hide();
    }

    count_workers();
}


async function init_workers() {
}

$(document).on('click', '.create-a-worker-btn', async function (e) {
    let name = await puter.ui.prompt('Please enter a name for your worker:', 'my-awesome-worker');

    if (name) {
        await create_worker(name);
    }
})

window.createDefaultWorkerFile = async () => {
    window.default_worker_file = `/${auth_username}/AppData/${dev_center_uid}/default_worker_file.js`;
    let existingFile;
    try {
        // Check if default_worker_file exists
        existingFile = await puter.fs.read(default_worker_file);
    } catch (err) {
        console.error('Error creating default worker file:', err);
    }

    if (!existingFile) {
        // Create default_worker_file
        await puter.fs.write(default_worker_file, `// This is an example application for Puter Workers

router.get('/', ({request}) => {
return 'Hello World'; // returns a string
});
router.get('/api/hello', ({request}) => {
return {'msg': 'hello'}; // returns a JSON object    
});
router.get('/*page', ({request, params}) => {
return new Response(\`Page \${params.page} not found\`, {status: 404});
});`);
    }

}

$(document).on('change', '.worker-checkbox', function (e) {
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

$('.refresh-worker-list').on('click', function (e) {
    puter.ui.showSpinner();
    refresh_worker_list();

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
            } else if(sortBy === 'user_count' || sortBy === 'open_count'){
                return a.stats[sortBy] - b.stats[sortBy];
            }else{
                a[sortBy] > b[sortBy] ? 1 : -1
            }
        });
    }else{
        sorted_workers = workers.sort((a, b) => {
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
    let count = 0;
    $('.worker-card').each(function () {
        count++;
    })
    $('.worker-count').html(count);
    return count;
}

function generate_worker_card(worker) {
    return `
        <tr class="worker-card" data-name="${html_encode(worker.name)}">
            <td style="width:50px; vertical-align: middle; line-height: 1;">
                <input type="checkbox" class="worker-checkbox" data-worker-name="${worker.name}">
            </td>
            <td style="font-family: monospace; font-size: 14px; vertical-align: middle;">${worker.name}</td>
            <td style="font-size: 14px; vertical-align: middle;">${worker.created_at}</td>
            <td style="vertical-align: middle;"><img class="options-icon options-icon-worker" data-worker-name="${worker.name}" src="./img/options.svg"></td>
        </tr>
    `;
}

$(document).on('input change keyup keypress keydown paste cut', '.search', function (e) {
    // search apps for query
    search_query = $(this).val().toLowerCase();
    if (search_query === '') {
        // hide 'clear search' button
        $('.search-clear').hide();
        // show all apps again
        $(`.worker-card`).show();
    } else {
        // show 'clear search' button
        $('.search-clear').show();
        // show apps that match search_query and hide apps that don't
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
    }
})

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
            $(`.worker-card[data-name="${worker_name}"]`).fadeOut(200, function name(params) {
                $(this).remove();
                if ($(`.worker-card`).length === 0) {
                    $('section:not(.sidebar)').hide();
                    $('#no-workers-notice').show();
                } else {
                    $('section:not(.sidebar)').hide();
                    $('#worker-list').show();
                }
                count_workers();
            });

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

$(document).on('contextmenu', '.worker-card', function (e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    puter.ui.contextMenu({
        items: [
            {
                label: 'Delete',
                type: 'danger',
                action: () => {
                    attempt_delete_worker($(this).attr('data-name'));
                },
            },
        ],
    });
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
                    attempt_delete_worker($(this).attr('data-worker-name'));
                },
            },
        ],
    });
})

async function attempt_delete_worker(worker_name) {

    // get worker
    const worker_data = await puter.workers.get(worker_name);

    if(worker_data.metadata?.locked){
        puter.ui.alert(`<strong>${worker_data.name}</strong> is locked and cannot be deleted.`, [
            {
                label: 'Ok',
            },
        ], {
            type: 'warning',
        });
        return;
    }

    // confirm delete
    const alert_resp = await puter.ui.alert(`Are you sure you want to premanently delete <strong>${html_encode(worker_data.name)}</strong>?`,
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
        puter.workers.delete(worker_name).then(async (worker) => {
                setTimeout(() => {
                    puter.ui.hideSpinner();
                    $(`.worker-card[data-name="${worker_name}"]`).fadeOut(200, function name(params) {
                        $(this).remove();
                        if ($(`.worker-card`).length === 0) {
                            $('section:not(.sidebar)').hide();
                            $('#no-workers-notice').show();
                        } else {
                            $('section:not(.sidebar)').hide();
                            $('#worker-list').show();
                        }
                        count_workers();
                    });
                },
                // make sure the modal was shown for at least 2 seconds
                (Date.now() - init_ts) > 2000 ? 1 : 2000 - (Date.now() - init_ts));
            }).catch(async (err) => {
                setTimeout(() => {
                    puter.ui.hideSpinner();
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
}

export default init_workers;