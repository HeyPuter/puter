// https://github.com/gr2m/localstorage-memory under MIT

const root = {};
var localStorageMemory = {}
var cache = {}

/**
 * number of stored items.
 */
localStorageMemory.length = 0

/**
 * returns item for passed key, or null
 *
 * @para {String} key
 *       name of item to be returned
 * @returns {String|null}
 */
localStorageMemory.getItem = function (key) {
  if (key in cache) {
    return cache[key]
  }

  return null
}

/**
 * sets item for key to passed value, as String
 *
 * @para {String} key
 *       name of item to be set
 * @para {String} value
 *       value, will always be turned into a String
 * @returns {undefined}
 */
localStorageMemory.setItem = function (key, value) {
  if (typeof value === 'undefined') {
    localStorageMemory.removeItem(key)
  } else {
    if (!(cache.hasOwnProperty(key))) {
      localStorageMemory.length++
    }

    cache[key] = '' + value
  }
}

/**
 * removes item for passed key
 *
 * @para {String} key
 *       name of item to be removed
 * @returns {undefined}
 */
localStorageMemory.removeItem = function (key) {
  if (cache.hasOwnProperty(key)) {
    delete cache[key]
    localStorageMemory.length--
  }
}

/**
 * returns name of key at passed index
 *
 * @para {Number} index
 *       Position for key to be returned (starts at 0)
 * @returns {String|null}
 */
localStorageMemory.key = function (index) {
  return Object.keys(cache)[index] || null
}

/**
 * removes all stored items and sets length to 0
 *
 * @returns {undefined}
 */
localStorageMemory.clear = function () {
  cache = {}
  localStorageMemory.length = 0
}

if (typeof exports === 'object') {
  module.exports = localStorageMemory
} else {
  root.localStorage = localStorageMemory
}


export default localStorageMemory;


