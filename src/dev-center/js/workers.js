window.workers = [];

window.create_worker = async (name) => {
    let worker = await puter.workers.create(name, window.default_worker_file);

    return worker;
}

window.refresh_worker_list = (show_loading = false) => {
    if (show_loading)
        puter.ui.showSpinner();
    // get workers
    setTimeout(function () {
        puter.workers.list().then((workers_res) => {
            workers = workers_res;
            puter.ui.hideSpinner();
        })
    }, 1000);
}


async function init_workers() {
}

$(document).on('click', '.create-a-worker-btn', async function (e) {
    let name = await puter.ui.prompt('Please enter a name for your worker:', 'my-awesome-worker');

    if (name) {
        console.log(name);
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


export default init_workers;