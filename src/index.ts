import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

// const Module = require('module');
// const originalRequire = Module.prototype.require;
//
// Module.prototype.require = function(path) {
// 	const result = originalRequire.call(this, path);
// 	console.log(`[LOADED]: ${path}`);
// 	return result;
// };

import { registerErrorHandlers } from './errorHandlers';
import { initServer } from './server';

registerErrorHandlers();
initServer().catch(console.error);
