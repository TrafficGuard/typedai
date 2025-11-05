// log-loader.js
const Module = require('node:module');
const path = require('node:path');
const originalRequire = Module.prototype.require;

const loadOrder = [];
const loadedFrom = new Map();
const requireStack = []; // Track the current require chain

Module.prototype.require = function (id) {
	const parentPath = this.filename ? path.relative(process.cwd(), this.filename) : '<unknown>';

	try {
		const resolvedPath = Module._resolveFilename(id, this);
		const relativePath = path.relative(process.cwd(), resolvedPath);

		// Push to stack before requiring
		if (!resolvedPath.includes('node_modules')) {
			requireStack.push(relativePath);
		}
	} catch (e) {
		// Couldn't resolve, skip
	}

	// biome-ignore lint/style/noArguments: ok
	const result = originalRequire.apply(this, arguments);

	try {
		const resolvedPath = Module._resolveFilename(id, this);

		// Filter out node_modules completely
		if (!resolvedPath.includes('node_modules')) {
			const relativePath = path.relative(process.cwd(), resolvedPath);

			// Only log if parent is also not from node_modules
			if (!parentPath.includes('node_modules')) {
				if (!loadedFrom.has(relativePath)) {
					loadOrder.push(relativePath);
					loadedFrom.set(relativePath, parentPath);
					console.log(`[${loadOrder.length}] Loaded: ${relativePath}`);
					console.log(`           From: ${parentPath}`);
				} else {
					// Only log cache hits for actual source files being re-required
					if (relativePath.startsWith('src/') || relativePath.startsWith('shared/')) {
						console.log(`[CACHE] ${relativePath}`);
						console.log(`        From: ${parentPath} (originally from: ${loadedFrom.get(relativePath)})`);
					}
				}
			}
		}
	} catch (e) {
		// Built-in modules or modules that can't be resolved
	} finally {
		// Pop from stack after requiring
		requireStack.pop();
	}

	return result;
};

// Catch unhandled errors and show the require stack
process.on('uncaughtException', (err) => {
	console.error('\n🔥 ERROR OCCURRED DURING MODULE LOADING');
	console.error('Current require stack:');
	requireStack.forEach((file, i) => {
		console.error(`  ${i + 1}. ${file}`);
	});
	console.error('\nError:', err.message);
	console.error(err.stack);
	process.exit(1);
});

// Log already loaded files at startup
const alreadyLoaded = Object.keys(require.cache)
	.filter((p) => !p.includes('node_modules'))
	.map((p) => path.relative(process.cwd(), p));

console.log('Already loaded before hook:', alreadyLoaded);

module.exports = { loadOrder };
