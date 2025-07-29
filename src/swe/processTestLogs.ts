import { llms } from '#agent/agentContextLocalStorage';

export async function processTestLogs(logs: string): Promise<string> {
	const prompt = `<logs>
${logs}
</logs>

Remove stack trace lines from core framework files
eg node:internal, node_modules/mocha/lib/runner.js
Output these logs stripping out framework stack trace lines and remove duplication of error message and stack traces.
Remove line numbers on node_module stack trace lines. Keep line numbers from application code.
Output a maximum of 10 lines from a single stack trace. Keeping the top few lines and the other most important lines.
Remove any lines which could not provide any value to debugging.
For example:
<user>
<logs>
LOG: '=== Entering BaseSpecPo.create() ==='
Chrome Headless 138.0.0.0 (Mac OS 10.15.7): Executed 5 of 396 (1 FAILED) (0 secs / 0.12 secs)
LOG: 'PromptFormComponent ngOnInit - navStateFromHistory:', null
Chrome Headless 138.0.0.0 (Mac OS 10.15.7): Executed 5 of 396 (1 FAILED) (0 secs / 0.12 secs)
LOG: 'PromptFormComponent ngOnInit - currentNavigation object:', null
Chrome Headless 138.0.0.0 (Mac OS 10.15.7): Executed 5 of 396 (1 FAILED) (0 secs / 0.12 secs)
LOG: 'PromptFormComponent ngOnInit - navStateFromRouter (from currentNavigation.extras.state):', undefined
Chrome Headless 138.0.0.0 (Mac OS 10.15.7): Executed 5 of 396 (1 FAILED) (0 secs / 0.12 secs)
LOG: 'PromptFormComponent ngOnInit - No "llmCallData" key found in navigation state from either source.'
Chrome Headless 138.0.0.0 (Mac OS 10.15.7): Executed 5 of 396 (1 FAILED) (0 secs / 0.12 secs)
LOG: 'processRouteData - resolvedPrompt:', null
Chrome Headless 138.0.0.0 (Mac OS 10.15.7): Executed 5 of 396 (1 FAILED) (0 secs / 0.12 secs)
LOG: 'processRouteData - llmCallDataForPrompt from initialNavigationState:', undefined
Chrome Headless 138.0.0.0 (Mac OS 10.15.7): Executed 5 of 396 (1 FAILED) (0 secs / 0.12 secs)
LOG: '=== Exiting BaseSpecPo.create() ==='
Chrome Headless 138.0.0.0 (Mac OS 10.15.7): Executed 5 of 396 (1 FAILED) (0 secs / 0.12 secs)
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

Chrome Headless 138.0.0.0 (Mac OS 10.15.7) PromptFormComponent Attachment Functionality should allow removing an attachment FAILED
        SyntaxError: Failed to execute 'matches' on 'Element': '[data-testid="input[type="file"]"]' is not a valid selector.
        error properties: Object({ code: 12, INDEX_SIZE_ERR: 1, DOMSTRING_SIZE_ERR: 2, HIERARCHY_REQUEST_ERR: 3, WRONG_DOCUMENT_ERR: 4, INVALID_CHARACTER_ERR: 5, NO_DATA_ALLOWED_ERR: 6, NO_MODIFICATION_ALLOWED_ERR: 7, NOT_FOUND_ERR: 8, NOT_SUPPORTED_ERR: 9, INUSE_ATTRIBUTE_ERR: 10, INVALID_STATE_ERR: 11, SYNTAX_ERR: 12, INVALID_MODIFICATION_ERR: 13, NAMESPACE_ERR: 14, INVALID_ACCESS_ERR: 15, VALIDATION_ERR: 16, TYPE_MISMATCH_ERR: 17, SECURITY_ERR: 18, NETWORK_ERR: 19, ABORT_ERR: 20, URL_MISMATCH_ERR: 21, QUOTA_EXCEEDED_ERR: 22, TIMEOUT_ERR: 23, INVALID_NODE_TYPE_ERR: 24, DATA_CLONE_ERR: 25 })
            at elementMatches (node_modules/@angular/platform-browser/fesm2022/platform-browser.mjs:372:33)
            at predicate (node_modules/@angular/platform-browser/fesm2022/platform-browser.mjs:354:19)
            at _addQueryMatch (node_modules/@angular/core/fesm2022/core.mjs:36924:13)
            at _queryNodeChildren (node_modules/@angular/core/fesm2022/core.mjs:36817:9)
            at _queryNodeChildren (node_modules/@angular/core/fesm2022/core.mjs:36823:17)
            at _queryAll (node_modules/@angular/core/fesm2022/core.mjs:36792:9)
            at DebugElement.queryAll (node_modules/@angular/core/fesm2022/core.mjs:36704:9)
            at PromptFormPo.els (src/test/base.po.ts:31:32)
            at src/app/modules/prompts/form/prompt-form.component.po.ts:199:27
            at Generator.next (<anonymous>)
<logs>
</user>
should be re-ouputed as:
<assistant>
LOG: '=== Entering BaseSpecPo.create() ==='
LOG: 'PromptFormComponent ngOnInit - navStateFromHistory:', null
LOG: 'PromptFormComponent ngOnInit - currentNavigation object:', null
LOG: 'PromptFormComponent ngOnInit - navStateFromRouter (from currentNavigation.extras.state):', undefined
LOG: 'PromptFormComponent ngOnInit - No "llmCallData" key found in navigation state from either source.'
LOG: 'processRouteData - resolvedPrompt:', null
LOG: 'processRouteData - llmCallDataForPrompt from initialNavigationState:', undefined
LOG: '=== Exiting BaseSpecPo.create() ==='
ERROR
message: [CodeTaskServiceImpl] Failed to accept design for session test-session-id
stackTrace: Error: Agent execution failed
  at Context. (./src/codeTask/codeTaskServiceImpl.test.ts:136:25)

PromptFormComponent Attachment Functionality should allow removing an attachment FAILED
        SyntaxError: Failed to execute 'matches' on 'Element': '[data-testid="input[type="file"]"]' is not a valid selector.
        error properties: Object({ code: 12, INDEX_SIZE_ERR: 1, DOMSTRING_SIZE_ERR: 2, HIERARCHY_REQUEST_ERR: 3, WRONG_DOCUMENT_ERR: 4, INVALID_CHARACTER_ERR: 5, NO_DATA_ALLOWED_ERR: 6, NO_MODIFICATION_ALLOWED_ERR: 7, NOT_FOUND_ERR: 8, NOT_SUPPORTED_ERR: 9, INUSE_ATTRIBUTE_ERR: 10, INVALID_STATE_ERR: 11, SYNTAX_ERR: 12, INVALID_MODIFICATION_ERR: 13, NAMESPACE_ERR: 14, INVALID_ACCESS_ERR: 15, VALIDATION_ERR: 16, TYPE_MISMATCH_ERR: 17, SECURITY_ERR: 18, NETWORK_ERR: 19, ABORT_ERR: 20, URL_MISMATCH_ERR: 21, QUOTA_EXCEEDED_ERR: 22, TIMEOUT_ERR: 23, INVALID_NODE_TYPE_ERR: 24, DATA_CLONE_ERR: 25 })
            at elementMatches (@angular/.../platform-browser.mjs)
            at predicate (@angular/.../platform-browser.mjs)
            at _addQueryMatch (@angular/.../core.mjs)
            at _queryNodeChildren (@angular/.../core.mjs)
            at _queryNodeChildren (@angular/.../core.mjs)
            at _queryAll (@angular/.../core.mjs)
            at DebugElement.queryAll (@angular/.../core.mjs)
            at PromptFormPo.els (src/test/base.po.ts:31:32)
            at src/app/modules/prompts/form/prompt-form.component.po.ts:199:27
            at Generator.next (<anonymous>)
</assistant>
 
Don't repsond with any small talk, output only the reformatted logs.
`;

	try {
		return await llms().medium.generateText(prompt, { id: 'Reformat test logs', temperature: 0.1, thinking: 'none' });
	} catch (e) {
		return logs;
	}
}
