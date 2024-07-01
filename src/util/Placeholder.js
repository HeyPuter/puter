/**
 * @typedef {Object} PlaceholderReturn
 * @property {String} html: An html string that represents the placeholder
 * @property {String} id: The unique ID of the placeholder
 * @property {Function} replaceWith: A function that takes a DOM element
 *   as an argument and replaces the placeholder with it
 */

/**
 * Placeholder creates a simple element with a unique ID
 * as an HTML string.
 * 
 * This can be useful where string concatenation is used
 * to build element trees.
 * 
 * The `replaceWith` method can be used to replace the
 * placeholder with a real element.
 * 
 * @returns {PlaceholderReturn}
 */
const Placeholder = def(() => {
    const id = Placeholder.get_next_id_();
    return {
        $: 'placeholder',
        html: `<div id="${id}"></div>`,
        id,
        replaceWith: (el) => {
            const place = document.getElementById(id);
            place.replaceWith(el);
        }
    };
}, 'util.Placeholder');

const anti_collision = `94d2cb6b85a1`; // Arbitrary random string
Placeholder.next_id_ = 0;
Placeholder.get_next_id_ = () => `${anti_collision}_${Placeholder.next_id_++}`;

export default Placeholder;
