import '#fastify/trace-init/trace-init';

import { startAgentAndWaitForCompletion } from '#agent/autonomous/autonomousAgentRunner';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { initApplicationContext } from '#app/applicationContext';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { CodeFunctions } from '#swe/codeFunctions';
import { registerErrorHandlers } from '../errorHandlers';
import { parseProcessArgs, saveAgentId } from './cli';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { FileSystemList } from '#functions/storage/fileSystemList';

async function main() {
	registerErrorHandlers();
	await initApplicationContext();
	const llms = defaultLLMs();

	const { initialPrompt, flags } = parseProcessArgs();
	const containerId = flags['container-id'] as string;

	if (!initialPrompt) {
		throw new Error('Problem statement must be provided as an argument.');
	}
	if (!containerId) {
		logger.warn('Running without a container. Commands will be executed on the host.');
	}

	const functions = [CodeEditingAgent, CodeFunctions, LiveFiles, FileSystemTree, FileSystemList];

	logger.info(`Available functions ${functions.map((f) => f.name).join(', ')}`);

	const requirements = `Please fix the following issue:\n${initialPrompt}`;

	const agentName = `SWE-bench agent for: ${initialPrompt.slice(0, 50)}...`;

	logger.info('Starting new swebench agent');
	const result = await startAgentAndWaitForCompletion({
		agentName,
		initialPrompt: requirements,
		functions: functions,
		llms,
		type: 'autonomous',
		subtype: 'codegen',
		containerId,
		// The working directory is set by the runner script, so we don't need to set fileSystemPath here
	});

	// The orchestrator will generate the patch via `git diff`.
	// This output can be used for debugging or if the agent directly produces a patch.
	console.log(result);
}

main().catch(console.error);
