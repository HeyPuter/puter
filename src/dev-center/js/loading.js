const SKELETON_STYLE_ID = 'dev-center-skeleton-styles';

const registry = {
    apps: {
        skeletonSelector: '[data-skeleton="apps"]',
        listSelector: '#app-list-table tbody',
    },
    workers: {
        skeletonSelector: '[data-skeleton="workers"]',
        listSelector: '#worker-list-table tbody',
    },
    websites: {
        skeletonSelector: '[data-skeleton="websites"]',
        listSelector: '#website-list-table tbody',
    },
    'payout-method': {
        skeletonSelector: '[data-skeleton="payout-method"]',
        listSelector: '#tab-payout-method .payout-body',
    },
};

const cache = new Map();
const counters = new Map();
let stylesInitialized = false;

function ensureStyles() {
    if (stylesInitialized || typeof document === 'undefined') {
        return;
    }

    if (document.getElementById(SKELETON_STYLE_ID)) {
        stylesInitialized = true;
        return;
    }

    const style = document.createElement('style');
    style.id = SKELETON_STYLE_ID;
    style.textContent = `
        .list-skeleton {
            display: none;
            flex-direction: column;
            gap: 12px;
            margin-top: 12px;
        }

        .list-skeleton.is-active {
            display: flex;
        }

        .skeleton-row {
            display: grid;
            grid-template-columns: 28px minmax(140px, 1.4fr) repeat(2, minmax(80px, 0.8fr)) minmax(120px, 1fr) 32px 32px;
            align-items: center;
            gap: 18px;
            padding: 14px 18px;
            border-radius: 4px;
            background: #ffffff;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
        }

        .skeleton-row--5col {
            grid-template-columns: 28px minmax(140px, 1.4fr) minmax(120px, 1fr) minmax(120px, 1fr) 32px;
        }

        .skeleton-row.--compact {
            display: flex;
            align-items: center;
            padding: 12px 0;
            background: transparent;
            box-shadow: none;
            gap: 16px;
        }

        .skeleton-block {
            background: linear-gradient(90deg, #f1f3f9 25%, #f8f9ff 50%, #f1f3f9 75%);
            background-size: 200% 100%;
            border-radius: 999px;
            height: 12px;
            animation: skeleton-shimmer 1.2s ease-in-out infinite;
        }

        .skeleton-block--checkbox {
            width: 18px;
            height: 18px;
            border-radius: 5px;
        }

        .skeleton-block--title {
            width: 70%;
            height: 14px;
            border-radius: 8px;
        }

        .skeleton-block--metric {
            width: 60px;
        }

        .skeleton-block--date {
            width: 90px;
        }

        .skeleton-block--path {
            width: 80%;
        }

        .skeleton-block--pill {
            width: 24px;
            height: 24px;
            border-radius: 50%;
        }

        .skeleton-block--icon {
            width: 24px;
            height: 24px;
            border-radius: 4px;
        }

        .skeleton-block--logo {
            width: 40px;
            height: 48px;
            border-radius: 12px;
        }

        .skeleton-block--text {
            flex: 1;
            height: 14px;
            border-radius: 8px;
        }

        @keyframes skeleton-shimmer {
            0% {
                background-position: -200% 0;
            }
            100% {
                background-position: 200% 0;
            }
        }
    `;

    document.head.appendChild(style);
    stylesInitialized = true;
}

function resolve(tab) {
    const config = registry[tab];
    if (!config) return null;

    if (!cache.has(tab)) {
        cache.set(tab, {
            skeleton: document.querySelector(config.skeletonSelector),
            list: config.listSelector ? document.querySelector(config.listSelector) : null,
        });
    }

    const entry = cache.get(tab);

    if (!entry?.skeleton && config.skeletonSelector) {
        entry.skeleton = document.querySelector(config.skeletonSelector);
    }

    if (!entry?.list && config.listSelector) {
        entry.list = document.querySelector(config.listSelector);
    }

    return entry;
}

export function showTabLoading(tab) {
    ensureStyles();
    const entry = resolve(tab);
    if (!entry) return;

    const count = counters.get(tab) ?? 0;
    if (count === 0) {
        if (entry.list) {
            entry.list.style.display = 'none';
        }
        if (entry.skeleton) {
            entry.skeleton.classList.add('is-active');
        }
    }
    counters.set(tab, count + 1);
}

export function hideTabLoading(tab) {
    const entry = resolve(tab);
    if (!entry) return;

    const count = Math.max(0, (counters.get(tab) ?? 0) - 1);
    counters.set(tab, count);

    if (count === 0) {
        if (entry.skeleton) {
            entry.skeleton.classList.remove('is-active');
        }
        if (entry.list) {
            entry.list.style.display = '';
        }
    }
}

export async function withTabLoading(tab, fn) {
    showTabLoading(tab);
    try {
        return await fn();
    } finally {
        hideTabLoading(tab);
    }
}
