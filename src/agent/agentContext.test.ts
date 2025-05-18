import { expect } from 'chai';
import sinon from 'sinon';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { createContext } from '#agent/agentContextLocalStorage';
import { deserializeContext, serializeContext } from '#agent/agentSerialization';
import type { RunAgentConfig } from '#agent/autonomous/autonomousAgentRunner';
import { appContext } from '#app/applicationContext';
import { LlmTools } from '#functions/util';
import { GPT41 } from '#llm/services/openai';
import type { AgentContext } from '#shared/model/agent.model';
import { functionRegistry } from '../functionRegistry';

describe('agentContext', () => {
	before(() => {
		// Required for deserialisation of functions
		functionRegistry();
	});

	describe('serialisation', () => {
		it('should be be identical after serialisation and deserialization', async () => {
			const llms = {
				easy: GPT41(),
				medium: GPT41(),
				hard: GPT41(),
				xhard: GPT41(),
			};
			// We want to check that the FileSystem gets re-added by the resetFileSystemFunction function
			const functions = new LlmFunctionsImpl(LlmTools); // FileSystemRead

			const config: RunAgentConfig = {
				agentName: 'SWE',
				type: 'autonomous',
				subtype: 'codegen',
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

			const deserialised = deserializeContext(serialized);
			const reserialised = serializeContext(deserialised);

			expect(serialized).to.be.deep.equal(reserialised);
		});
	});
});
