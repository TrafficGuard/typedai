import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { copyFileSync, existsSync } from 'node:fs';
import { agentContext } from '#agent/agentContextLocalStorage';

agentContext();

if (!existsSync('variables/test.env')) {
	console.log('Copying variables/local.env.example to variables/test.env');
	copyFileSync('variables/local.env.example', 'variables/test.env');
}
