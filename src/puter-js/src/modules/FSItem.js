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