if (!process.env.TS_NODE_TRANSPILE_ONLY) {
	process.env.TS_NODE_TRANSPILE_ONLY = '1';
}
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
