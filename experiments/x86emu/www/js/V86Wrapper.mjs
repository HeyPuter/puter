let V86;

if (typeof window !== 'undefined') {
	V86 = window.V86;
} else {
	try {
		const { createRequire } = await import('module');
		const require = createRequire(import.meta.url);
		const NodeV86 = require("../third-party/libv86.js");
		V86 = NodeV86.V86;
	} catch (error) {
		console.error('Failed to load V86 in Node.js environment:', error);
	}
}

export { V86 };
