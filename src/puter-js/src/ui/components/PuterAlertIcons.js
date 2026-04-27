/**
 * Default alert icons — original flat SVGs drawn from geometric
 * primitives, base64-encoded at module load for use as data URIs.
 */

const toDataURI = (svg) =>
    `data:image/svg+xml;base64,${btoa(svg)}`;

const SVGS = {
    error: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="20" fill="#e53935"/>
  <rect x="22" y="12" width="4" height="16" rx="2" fill="#ffffff"/>
  <circle cx="24" cy="34" r="2.5" fill="#ffffff"/>
</svg>`,

    warning: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <path d="M24 5 L44 40 L4 40 Z" fill="#ffc107" stroke="#e0a800" stroke-width="1.5" stroke-linejoin="round"/>
  <rect x="22" y="18" width="4" height="12" rx="2" fill="#3f3f3f"/>
  <circle cx="24" cy="35" r="2" fill="#3f3f3f"/>
</svg>`,

    info: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="20" fill="#2196f3"/>
  <circle cx="24" cy="14" r="2.5" fill="#ffffff"/>
  <rect x="22" y="20" width="4" height="16" rx="2" fill="#ffffff"/>
</svg>`,

    success: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="20" fill="#4caf50"/>
  <path d="M14 24 L21 31 L34 17" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    confirm: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="20" fill="#2196f3"/>
  <path d="M18.5 18.5 Q18.5 12.5 24 12.5 Q29.5 12.5 29.5 18 Q29.5 22 25.5 24 Q24 24.8 24 27.5" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="24" cy="34" r="2.25" fill="#ffffff"/>
</svg>`,
};

export const DEFAULT_ALERT_ICONS = {
    error: toDataURI(SVGS.error),
    warning: toDataURI(SVGS.warning),
    info: toDataURI(SVGS.info),
    success: toDataURI(SVGS.success),
    confirm: toDataURI(SVGS.confirm),
};
