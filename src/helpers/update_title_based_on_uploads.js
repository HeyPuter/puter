const update_title_based_on_uploads = function(){
    const active_uploads_count = _.size(active_uploads);
    if(active_uploads_count === 1 && !isNaN(Object.values(active_uploads)[0])){
        document.title = Math.round(Object.values(active_uploads)[0]) + '% Uploading';
    }else if(active_uploads_count > 1){
        // get the average progress
        let total_progress = 0;
        for (const [key, value] of Object.entries(active_uploads)) {
            total_progress += Math.round(value);
        }
        const avgprog = Math.round(total_progress / active_uploads_count)
        if(!isNaN(avgprog))
            document.title = avgprog + '% Uploading';
    }
}

export default update_title_based_on_uploads;