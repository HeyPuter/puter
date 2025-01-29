/**
 * Select the object with the highest version.
 * Objects are of the form:
 *   { version: '1.2.0' }
 * 
 * Semver is assumed.
 * 
 * @param {*} objects 
 */
const find_highest_version = (objects) => {
    let highest = [0,0,0];
    let highest_obj = null;

    for ( const obj of objects ) {
        const parts = obj.version.split('.');
        for ( let i = 0; i < 3; i++ ) {
            const part = parseInt(parts[i]);
            if ( part > highest[i] ) {
                highest = parts;
                highest_obj = obj;
                break;
            } else if ( part < highest[i] ) {
                break;
            }1
        }
    }

    return highest_obj;
};

module.exports = {
    find_highest_version,
};
