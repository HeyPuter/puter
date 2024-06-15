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
            "packages/backend/src/public/assets/**",
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
            "packages/backend/**/*.js",
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
            "index.js",
            "initgui.js",
            "src/**/*.js",
            "packages/**/*.js",
        ],
        ignores: [
            "packages/backend/**/*.js",
        ],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.commonjs,
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
                "JSZip": true,          // JSZip
                "_": true,              // lodash
                "QRCode": true,         // qrcode
                "io": true,             // socket.io
                "timeago": true,        // timeago
                "SelectionArea": true,  // viselect
                // Puter GUI Globals
                "set_menu_item_prop": true,
                "determine_active_container_parent": true,
                "privacy_aware_path": true,
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
            "packages/phoenix/**/*.js",
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
