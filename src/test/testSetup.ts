import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { agentContext } from '#agent/agentContextLocalStorage';

agentContext();
