// Shared field remapping for the puter.apps methods: the public options use
// camelCase (indexURL, maximizeOnStart, ...) while the `puter-apps` driver
// expects snake_case. create() and update() share this so the field list
// lives in exactly one place.

/**
 * @typedef {import('../../../../types/modules/apps').CreateAppOptions
 *     | import('../../../../types/modules/apps').UpdateAppAttributes} AppAttributes
 */

/**
 * Maps the camelCase public app attributes to the snake_case `object` the
 * driver stores. `title` is passed through as-is; create() overlays its
 * name-fallback default on top.
 *
 * @param {AppAttributes} raw
 * @returns {Record<string, unknown>}
 */
export const toAppObject = (raw) => ({
    name: raw.name,
    index_url: raw.indexURL,
    title: raw.title,
    description: raw.description,
    icon: raw.icon,
    maximize_on_start: raw.maximizeOnStart,
    background: raw.background,
    filetype_associations: raw.filetypeAssociations,
    metadata: raw.metadata,
});
