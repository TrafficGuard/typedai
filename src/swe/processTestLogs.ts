import { llms } from '#agent/agentContextLocalStorage';

export async function processTestLogs(logs: string): Promise<string> {
	const prompt = `<logs>
${logs}
</logs>

Output these logs stripping out framework stack trace lines
and remove duplication of error message and stack traces.

For example:

ERROR (81608):
severity: "ERROR"
stack_trace: "Error: Agent execution failed\\n at Context. (/Users/johndoe/typedai/src/codeTask/codeTaskServiceImpl.test.ts:136:25)\\n at callFn (/Users/johndoe/typedai/node_modules/mocha/lib/runnable.js:364:21)\\n at Test.Runnable.run (/Users/johndoe/typedai/node_modules/mocha/lib/runnable.js:352:5)\\n at Runner.runTest (/Users/johndoe/typedai/node_modules/mocha/lib/runner.js:677:10)\\n at /Users/johndoe/typedai/node_modules/mocha/lib/runner.js:800:12\\n at next (/Users/johndoe/typedai/node_modules/mocha/lib/runner.js:592:14)\\n at /Users/johndoe/typedai/node_modules/mocha/lib/runner.js:602:7\\n at next (/Users/johndoe/typedai/node_modules/mocha/lib/runner.js:485:14)\\n at Immediate. (/Users/johndoe/typedai/node_modules/mocha/lib/runner.js:570:5)\\n at processImmediate (node:internal/timers:478:21)\\n at process.topLevelDomainCallback (node:domain:160:15)\\n at process.callbackTrampoline (node:internal/async_hooks:128:24)"
message: "[CodeTaskServiceImpl] Failed to accept design for session test-session-id"
err: {
"type": "Error",
"message": "Agent execution failed",
"stack":
Error: Agent execution failed
at Context. (/Users/johndoe/typedai/src/codeTask/codeTaskServiceImpl.test.ts:136:25)
at callFn (/Users/johndoe/typedai/node_modules/mocha/lib/runnable.js:364:21)
at Test.Runnable.run (/Users/johndoe/typedai/node_modules/mocha/lib/runnable.js:352:5)
at Runner.runTest (/Users/johndoe/typedai/node_modules/mocha/lib/runner.js:677:10)
at /Users/johndoe/typedai/node_modules/mocha/lib/runner.js:800:12
at next (/Users/johndoe/typedai/node_modules/mocha/lib/runner.js:592:14)
at /Users/johndoe/typedai/node_modules/mocha/lib/runner.js:602:7
at next (/Users/johndoe/typedai/node_modules/mocha/lib/runner.js:485:14)
at Immediate. (/Users/johndoe/typedai/node_modules/mocha/lib/runner.js:570:5)
at processImmediate (node:internal/timers:478:21)
at process.topLevelDomainCallback (node:domain:160:15)
at process.callbackTrampoline (node:internal/async_hooks:128:24)
}

should be re-ouputed as:

ERROR
message: [CodeTaskServiceImpl] Failed to accept design for session test-session-id
stackTrace: Error: Agent execution failed
  at Context. (./src/codeTask/codeTaskServiceImpl.test.ts:136:25)
  
 
Don't repsond with any small talk, output only the reformatted logs.
`;

	try {
		return await llms().medium.generateText(prompt, { id: 'Reformat test logs', temperature: 0.1 });
	} catch (e) {
		return logs;
	}
}
