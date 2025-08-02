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



export default init_workers;