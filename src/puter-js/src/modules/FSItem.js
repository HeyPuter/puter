import path from "../lib/path.js"

class FSItem{
    constructor(options){
        this.readURL        = options.readURL ?? options.read_url;
        this.writeURL       = options.writeURL ?? options.write_url;
        this.metadataURL    = options.metadataURL ?? options.metadata_url;
        this.name           = options.name ?? options.fsentry_name;
        this.uid            = options.uid ?? options.uuid ?? options.fsentry_uid ?? options.fsentry_id ?? options.fsentry_uuid ?? options.id;
        this.id             = this.uid;
        this.uuid           = this.uid;
        this.path           = options.path ?? options.fsentry_path;
        this.size           = options.size ?? options.fsentry_size;
        this.accessed       = options.accessed ?? options.fsentry_accessed;
        this.modified       = options.modified ?? options.fsentry_modified;
        this.created        = options.created ?? options.fsentry_created;
        this.isDirectory    = (options.isDirectory || options.is_dir || options.fsentry_is_dir) ? true : false;
        
        // We add some properties to '_internalProperties' to make it clear
        // that they are not meant to be accessed outside of puter.js;
        // this permits us to change or remove these properties in the future.
        const internalProperties = {};
        Object.defineProperty(this, '_internalProperties', {
            enumerable: false,
            value: internalProperties,
        });
        
        // Currently 'signature' and 'expires' are not provided in 'options',
        // but they can be inferred by writeURL or readURL.
        internalProperties.signature = options.signature ?? (() => {
            const url = new URL(this.writeURL ?? this.readURL);
            return url.searchParams.get('signature');
        })();
        internalProperties.expires = options.expires ?? (() => {
            const url = new URL(this.writeURL ?? this.readURL);
            return url.searchParams.get('expires');
        })();
        
        // This computed property gives us an object in the format output by
        // the `/sign` endpoint, which can be passed to `launch_app` to
        // allow apps to open a file in another app or another instance.
        Object.defineProperty(internalProperties, 'file_signature', {
            get: () => ({
                read_url: this.readURL,
                write_url: this.writeURL,
                metadata_url: this.metadataURL,
                fsentry_accessed: this.accessed,
                fsentry_modified: this.modified,
                fsentry_created: this.created,
                fsentry_is_dir: this.isDirectory,
                fsentry_size: this.size,
                fsentry_name: this.name,
                path: this.path,
                uid: this.uid,
                // /sign outputs another property called "type", but we don't
                // have that information here, so it's omitted.
            })
        });
    }
    
    write = async function(data){
        return puter.fs.write( 
            this.path,
            new File([data], this.name), 
            {
                overwrite: true,
                dedupeName: false,
            },
        );
    }

    // Watches for changes to the item, and calls the callback function
    // with the new data when a change is detected.
    watch = function(callback){
        // todo - implement
    }

    open = function(callback){
        // todo - implement
    }

    // Set wallpaper
    setAsWallpaper = function(options, callback){
        // todo - implement
    }

    rename = function(new_name){
        return puter.fs.rename(this.uid, new_name);
    }

    move = function(dest_path, overwrite=false, new_name){
        return puter.fs.move(this.path, dest_path, overwrite, new_name);
    }

    copy = function(destination_directory, auto_rename=false, overwrite=false){
        return puter.fs.copy(this.path, destination_directory, auto_rename, overwrite);
    }

    delete = function(){
        return puter.fs.delete(this.path);
    }

    versions = async function(){
        // todo - implement
    }

    trash = function(){
        // todo make sure puter allows for moving to trash by default
        // todo implement trashing
    }

    mkdir = async function(name, auto_rename = false){
        // Don't proceed if this is not a directory, throw error
        if(!this.isDirectory)
            throw new Error('mkdir() can only be called on a directory');    
        
        // mkdir
        return puter.fs.mkdir(path.join(this.path, name));
    }

    metadata = async function(){
        // todo - implement
    }

    readdir = async function(){
        // Don't proceed if this is not a directory, throw error
        if(!this.isDirectory)
            throw new Error('readdir() can only be called on a directory');

        // readdir
        return puter.fs.readdir(this.path);
    }

    read = async function(){
        return puter.fs.read(this.path);
    }
}

export default FSItem;