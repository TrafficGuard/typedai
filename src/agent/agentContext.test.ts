import { expect } from 'chai';
import sinon from 'sinon';
import { LlmFunctions } from '#agent/LlmFunctions';
import { createContext } from '#agent/agentContextLocalStorage';
import { AgentContext } from '#agent/agentContextTypes';
import { RunAgentConfig } from '#agent/agentRunner';
import { deserializeAgentContext, serializeContext } from '#agent/agentSerialization';
// import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { LlmTools } from '#functions/util';
import { GPT4o } from '#llm/services/openai';
import { appContext } from '../applicationContext';
import { functionRegistry } from '../functionRegistry';

describe('agentContext', () => {
	before(() => {
		// Required for deserialisation of functions
		functionRegistry();
	});

	describe('serialisation', () => {
		it('should be be identical after serialisation and deserialization', async () => {
			const llms = {
				easy: GPT4o(),
				medium: GPT4o(),
				hard: GPT4o(),
				xhard: GPT4o(),
			};
			// We want to check that the FileSystem gets re-added by the resetFileSystemFunction function
			const functions = new LlmFunctions(LlmTools); // FileSystemRead

			const config: RunAgentConfig = {
				agentName: 'SWE',
				llms,
				functions,
				user: appContext().userService.getSingleUser(),
				initialPrompt: 'question',
				metadata: { 'metadata-key': 'metadata-value' },
			};
			const agentContext: AgentContext = createContext(config);
			agentContext.fileSystem.setWorkingDirectory('./src');
			agentContext.memory.memory_key = 'memory_value';
			agentContext.functionCallHistory.push({
				function_name: 'func',
				parameters: {
					p1: 'v1',
					p2: true,
				},
				stdout: 'output',
				stderr: 'errors',
				stdoutSummary: 'outSummary',
				stderrSummary: 'stderrSummary',
			});
			const serialized = serializeContext(agentContext);
			const serializedToString: string = JSON.stringify(serialized);

			expect(serializedToString).to.include('memory_key');
			expect(serializedToString).to.include('memory_value');
			expect(serializedToString).to.include('easy');
			expect(serializedToString).to.include('medium');
			expect(serializedToString).to.include('workingDir');
			expect(serializedToString).to.include('LlmTools');

			const deserialised = await deserializeAgentContext(serialized);
			const reserialised = serializeContext(deserialised);

			expect(serialized).to.be.deep.equal(reserialised);
		});
	});
});
