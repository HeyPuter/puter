import path from "../../../lib/path.js"
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

const write = async function (targetPath, data, options = {}) {
    // targetPath is required
    if(!targetPath){
        throw new Error({ code: 'NO_TARGET_PATH', message: 'No target path provided.' });
    }
    // if targetPath is a File
    if(targetPath instanceof File && data === undefined){
        data = targetPath;
        targetPath = data.name;
    }

    // strict mode will cause the upload to fail if even one operation fails
    // for example, if one of the files in a folder fails to upload, the entire upload will fail
    // since write is a wrapper around upload to handle single-file uploads, we need to pass the strict option to upload
    options.strict = true;

    // by default, we want to overwrite existing files
    options.overwrite = options.overwrite ?? true;

    // if overwrite is true and dedupeName is not provided, set dedupeName to false
    if(options.overwrite && options.dedupeName === undefined)
        options.dedupeName = false;

    // if targetPath is not provided or it's not starting with a slash, it means it's a relative path
    // in that case, we need to prepend the app's root directory to it
    targetPath = getAbsolutePathForApp(targetPath);

    // extract file name from targetPath
    const filename = path.basename(targetPath);

    // extract the parent directory from targetPath
    const parent = path.dirname(targetPath);

    // if data is a string, convert it to a File object
    if(typeof data === 'string'){
        data = new File([data ?? ''], filename ?? 'Untitled.txt', { type: "text/plain" });
    }
    // blob
    else if(data instanceof Blob){
        data = new File([data ?? ''], filename ?? 'Untitled', { type: data.type });
    }

    if(!data)
        data = new File([data ?? ''], filename);

    // data should be a File now. If it's not, it's an unsupported type
    if (!(data instanceof File)) {
        throw new Error({ code: 'field_invalid', message: 'write() data parameter is an invalid type' });
    }

    // perform upload
    return this.upload(data, parent, options);
}

export default write;