/**
 * When columns are selected from a joined table and prefixed:
 *
 *   SELECT joined_table.* AS joined_table_
 *
 * This function is able to extract the object from the result:
 *
 * extract_from_prefix(row, 'joined_table_') // columns of joined_table
 *
 * @param {*} row
 * @param {*} prefix
 */
export const extract_from_prefix = (row, prefix) => {
    const result = {};
    for ( const [key, value] of Object.entries(row) ) {
        if ( key.startsWith(prefix) ) {
            result[key.replace(prefix, '')] = value;
        }
    }
    return result;
};
