/**
 * Filters a permission reading so that it does not contain paths through the
 * specified user. This operation is performed recursively on all paths in the
 * reading.
 * 
 * This does not prevent all possible cycles. To prevent all cycles, this filter
 * must by applied on each reading for a permission holder, specifying the
 * permission issuer as the user to filter out.
 */
const remove_paths_through_user = ({ reading, user }) => {
    const no_cycle_reading = [];

    for ( const node of reading ) {
        if ( node.$ === 'path' ) {
            if (
                node.issuer_username === user.username
            ) {
                console.log('filtered out one');
                // process.exit(0);
                continue;
            }

            node.reading = remove_paths_through_user({
                reading: node.reading,
                user,
            });
        }

        no_cycle_reading.push(node);
    }

    return no_cycle_reading;
};

const reading_has_terminal = ({ reading }) => {
    for ( const node of reading ) {
        if ( node.has_terminal ) {
            return true;
        }
        if ( node.$ === 'option' ) {
            return true;
        }
    }

    return false;
};

module.exports = {
    remove_paths_through_user,
    reading_has_terminal,
};
