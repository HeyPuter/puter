import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,

    {
        // Global ignores
        ignores: [
            "**/*.min.js",
            "**/src/lib/**",
            "**/dist/",
            "src/backend/src/public/assets/**",
            "incubator/**"
        ],
    },
    {
        // Top-level and tools use Node
        files: [
            "tools/**/*.js",
        ],
        languageOptions: {
            globals: {
                ...globals.node,
            }
        }
    },
    {
        // Back end
        files: [
            "src/backend/**/*.js",
            "mods/**/*.js",
            "dev-server.js",
            "utils.js",
        ],
        languageOptions: {
            globals: {
                ...globals.node,
                "kv": true,
                "def": true,
                "use": true,
                "ll":true,
            }
        }
    },
    {
        // Front end
        files: [
            "src/**/*.js",
        ],
        ignores: [
            "src/backend/**/*.js",
        ],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.commonjs,
                // Weird false positives
                "Buffer": true,
                // Puter Common
                "puter": true,
                "i18n": true,
                "html_encode": true,
                "html_decode": true,
                "isMobile": true,
                // Class Registry
                "logger": true,
                "def": true,
                "use": true,
                // Libraries
                "saveAs": true,         // FileSaver
                "iro": true,            // iro.js color picker
                "$": true,              // jQuery
                "jQuery": true,         // jQuery
                "fflate": true,         // fflate
                "_": true,              // lodash
                "QRCode": true,         // qrcode
                "io": true,             // socket.io
                "timeago": true,        // timeago
                "SelectionArea": true,  // viselect
                // Puter GUI Globals
                "set_menu_item_prop": true,
                "determine_active_container_parent": true,
                "privacy_aware_path": true,
                "api_origin": true,
                "auth_token": true,
                "logout": true,
                "is_email": true,
                "select_ctxmenu_item": true,
            }
        }
    },
    {
        // Mods
        // NOTE: Mods have backend and frontend parts, so this just includes the globals for both.
        files: [
            "mods/**/*.js",
        ],
        languageOptions: {
            globals: {
                ...globals.node,
                "use": true,
                "window": true,
                "puter": true,
            }
        }
    },
    {
        // Tests
        files: [
            "**/test/**/*.js",
        ],
        languageOptions: {
            globals: {
                ...globals.mocha,
            }
        }
    },
    {
        // Phoenix
        files: [
            "src/phoenix/**/*.js",
        ],
        languageOptions: {
            globals: {
                ...globals.node,
            }
        }
    },
    {
        // Global rule settings
        rules: {
            "no-prototype-builtins": "off", // Complains about any use of hasOwnProperty()
            "no-unused-vars": "off", // Temporary, we just have a lot of these
            "no-debugger": "warn",
            "no-async-promise-executor": "off",  // We do this quite often and it's fine
        }
    },
];
