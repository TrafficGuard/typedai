// log-loader.js
const Module = require('node:module');
const path = require('node:path');
const originalRequire = Module.prototype.require;

const loadOrder = [];

Module.prototype.require = function (id) {
	// biome-ignore lint/style/noArguments: ok
	const result = originalRequire.apply(this, arguments);

	// Get the resolved path
	try {
		const resolvedPath = Module._resolveFilename(id, this);

		// Filter out node_modules
		if (!resolvedPath.includes('node_modules')) {
			const relativePath = path.relative(process.cwd(), resolvedPath);
			if (!loadOrder.includes(relativePath)) {
				loadOrder.push(relativePath);
				console.log(`[${loadOrder.length}] Loaded: ${relativePath}`);
			}
		}
	} catch (e) {
		// Built-in modules or modules that can't be resolved
	}

	return result;
};

// Export to use elsewhere if needed
module.exports = { loadOrder };
