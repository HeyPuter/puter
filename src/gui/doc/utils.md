# utils.js — GUI Build Script (Overview)

This file is responsible for:
- Generating production and development builds of the GUI
- Merging and minifying JS/CSS files
- Converting icon files to base64
- Bundling core GUI logic using Webpack
- Generating the HTML structure dynamically for development mode

## Main Functions

### 🔧 build(options)
Runs the full GUI build process.

**Steps it performs:**
1. Deletes and recreates the `/dist` folder
2. Merges JavaScript libraries → `dist/libs.js`
3. Converts all `src/icons/*.svg/png` to base64 → stores in `window.icons`
4. Merges and minifies CSS → `dist/bundle.min.css`
5. Uses Webpack to bundle `src/index.js` and dependencies → `dist/main.js`
6. Prepends `window.gui_env = "prod"` and writes it as `dist/gui.js`
7. Copies static assets like images, fonts, manifest, etc.

### 🛠️ generateDevHtml(options)
Dynamically builds the HTML string for development mode.

**What it includes:**
- Meta tags (SEO + social)
- CSS & JS includes (based on env)
- Inline base64 image data
- JS entry points for dev (`/index.js`) or prod (`/dist/gui.js`)

---

## Related Files

| File             | Role                                 |
|------------------|---------------------------------------|
| `build.js`       | Just imports and calls `build()`      |
| `BaseConfig.cjs` | Provides Webpack config used in build |
| `static-assets.js` | Lists paths to JS, CSS, icons, etc   |

---

