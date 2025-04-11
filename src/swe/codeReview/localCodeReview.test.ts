import { expect } from 'chai';
import { parseGitDiff, DiffInfo } from './localCodeReview'; // Adjust path if needed

// The sample diff output provided in the prompt
const sampleDiffOutput = `
diff --git a/src/cli/files.ts b/src/cli/files.ts
index 39592e3..129ef8c 100644
--- a/src/cli/files.ts
+++ b/src/cli/files.ts
@@ -1,9 +1,9 @@
 import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

-import { writeFileSync } from 'fs';
+import { writeFileSync } from 'node:fs';
 import { agentContext, llms } from '#agent/agentContextLocalStorage';
-import { AgentLLMs } from '#agent/agentContextTypes';
-import { RunAgentConfig } from '#agent/agentRunner';
+import type { AgentLLMs } from '#agent/agentContextTypes';
+import type { RunAgentConfig } from '#agent/agentRunner';
 import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
 import { shutdownTrace } from '#fastify/trace-init/trace-init';
 import { defaultLLMs } from '#llm/services/defaultLlms';
diff --git a/src/cli/functionResolver.ts b/src/cli/functionResolver.ts
index 5bac499..4a9d61e 100644
--- a/src/cli/functionResolver.ts
+++ b/src/cli/functionResolver.ts
@@ -1,11 +1,13 @@
 import { llms } from '#agent/agentContextLocalStorage';
 import { LiveFiles } from '#agent/liveFiles';
+import { CustomFunctions } from '#functions/customFunctions';
 import { Jira } from '#functions/jira';
-import { FileSystemRead } from '#functions/storage/FileSystemRead';
-import { FileSystemWrite } from '#functions/storage/FileSystemWrite';
+import { FileSystemList } from '#functions/storage/fileSystemList';
+import { FileSystemRead } from '#functions/storage/fileSystemRead';
+import { FileSystemWrite } from '#functions/storage/fileSystemWrite';
 import { Perplexity } from '#functions/web/perplexity';
 import { PublicWeb } from '#functions/web/web';
-import { LLM } from '#llm/llm';
+import type { LLM } from '#llm/llm';
 import { defaultLLMs } from '#llm/services/defaultLlms';
 import { logger } from '#o11y/logger';
 import { CodeEditingAgent } from '#swe/codeEditingAgent';
@@ -19,6 +21,7 @@ const functionAliases: Record<string, string> = {
        swe: SoftwareDeveloperAgent.name,
        code: CodeEditingAgent.name,
        fs: FileSystemRead.name,
+       fsl: FileSystemList.name,
        fsw: FileSystemWrite.name,
        web: PublicWeb.name,
        pp: Perplexity.name,
@@ -26,6 +29,7 @@ const functionAliases: Record<string, string> = {
        ts: TypescriptTools.name,
        jira: Jira.name,
        live: LiveFiles.name,
+       custom: CustomFunctions.name,
 };
 
 interface FunctionMatch {
@@ -56,7 +60,7 @@ export async function resolveFunctionClasses(requestedFunctions: string[]): Prom
                                        functionAliases,
                                )
                                        .map(([k, v]) => \`\${k} -> \${v}\`)
-                                       .join(', ')}\`,
+                                       .join(', ')}\\nCheck the alias is correct and the function class is registered in the function registry.\`,
                        );
                }
 
@@ -70,7 +74,7 @@ export async function resolveFunctionClasses(requestedFunctions: string[]): Prom
 async function buildFunctionMatches(requested: string, registryMap: Map<string, any>, llm: LLM): Promise<FunctionMatch> {
        const requestedLower = requested.toLowerCase();
 
-       // Try exact match first (case insensitive)
+       // Try exact match first (case-insensitive)
        const exactMatch = Array.from(registryMap.keys()).find((key) => key.toLowerCase() === requestedLower);
        if (exactMatch) {
                return {
diff --git a/src/cli/gaia.ts b/src/cli/gaia.ts
index 16517f9..612455c 100644
--- a/src/cli/gaia.ts
+++ b/src/cli/gaia.ts
@@ -1,14 +1,15 @@
 import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

-import { promises as fs, readFileSync } from 'fs';
-import { AgentLLMs } from '#agent/agentContextTypes';
+import { promises as fs, readFileSync } from 'node:fs';
+import type { AgentLLMs } from '#agent/agentContextTypes';
 import { AGENT_COMPLETED_PARAM_NAME } from '#agent/agentFunctions';
 import { startAgentAndWait } from '#agent/agentRunner';
-import { FileSystemRead } from '#functions/storage/FileSystemRead';
+import { FileSystemRead } from '#functions/storage/fileSystemRead';
 import { LlmTools } from '#functions/util';
 import { Perplexity } from '#functions/web/perplexity';
 import { PublicWeb } from '#functions/web/web';
-import { LlmCall } from '#llm/llmCallService/llmCall';
+import { lastText } from '#llm/llm';
+import type { LlmCall } from '#llm/llmCallService/llmCall';
 import { Claude3_5_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
 import { defaultLLMs } from '#llm/services/defaultLlms';
 import { groqLlama3_3_70B } from '#llm/services/groq';
@@ -110,9 +111,9 @@ async function answerGaiaQuestion(task: GaiaQuestion): Promise<GaiaResult> {
 
                // Extract reasoning trace from LLM calls
                const reasoningTrace: string[] = llmCalls
-                       .filter((call: LlmCall) => call.responseText.includes('<python-code>'))
+                       .filter((call: LlmCall) => lastText(call.messages).includes('<python-code>'))
                        .map((call) => {
-                               const match = call.responseText.match(/<python-code>(.*?)<\\/python-code>/s);
+                               const match = lastText(call.messages).match(/<python-code>(.*?)<\\/python-code>/s);
                                return match ? match[1].trim() : '';
                        });
 
diff --git a/src/cli/gen.ts b/src/cli/gen.ts
index ebc00c3..33419a5 100644
--- a/src/cli/gen.ts
+++ b/src/cli/gen.ts
@@ -1,46 +1,30 @@
 import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

-import { writeFileSync } from 'fs';
-import { agentContext, agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
-import { AgentContext } from '#agent/agentContextTypes';
+import { writeFileSync } from 'node:fs';
 import { defaultLLMs } from '#llm/services/defaultLlms';
-import { initApplicationContext } from '../applicationContext';
-import { parseProcessArgs, saveAgentId } from './cli';
+import { countTokens } from '#llm/tokens';
+import { parseProcessArgs } from './cli';
 
 // Usage:
 // npm run gen
 
 async function main() {
        const llms = defaultLLMs();
-       await initApplicationContext();
 
        const { initialPrompt } = parseProcessArgs();
 
-       const context: AgentContext = createContext({
-               initialPrompt,
-               agentName: 'gen',
-               llms,
-               functions: [],
-       });
-       agentContextStorage.enterWith(context);
-
-       const text = await llms.medium.generateText(initialPrompt, null, { temperature: 0.5 });
+       const llm = llms.medium;
+       const tokens = await countTokens(initialPrompt);
+       console.log(\`Generating with \${llm.getId()}. Input \${tokens} tokens\\n\`);
+       const start = Date.now();
+       const text = await llm.generateText(initialPrompt);
+       const duration = Date.now() - start;
 
        writeFileSync('src/cli/gen-out', text);
 
        console.log(text);
-       console.log();
+       console.log(\`\\nGenerated \${await countTokens(text)} tokens by \${llm.getId()} in \${(duration / 1000).toFixed(1)} seconds\`);
        console.log('Wrote output to src/cli/gen-out');
-       console.log(\`Cost USD$\${agentContext().cost.toFixed(2)}\`);
-
-       // Save the agent ID after a successful run
-       saveAgentId('gen', context.agentId);
 }
 
-main()
-       .then(() => {
-               console.log('done');
-       })
-       .catch((e) => {
-               console.error(e);
-       });
+main().catch(console.error);
diff --git a/src/cli/index.ts b/src/cli/index.ts
index 22f98be..50629eb 100644
--- a/src/cli/index.ts
+++ b/src/cli/index.ts
@@ -1,7 +1,7 @@
 import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

-import { AgentLLMs } from '#agent/agentContextTypes';
-import { RunAgentConfig } from '#agent/agentRunner';
+import type { AgentLLMs } from '#agent/agentContextTypes';
+import type { RunAgentConfig } from '#agent/agentRunner';
 import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
 import { shutdownTrace } from '#fastify/trace-init/trace-init';
 import { defaultLLMs } from '#llm/services/defaultLlms';
@@ -32,9 +32,9 @@ async function main() {
 
        const maps = await generateRepositoryMaps(await detectProjectInfo());
 
-       console.log(\`languageProjectMap \${maps.languageProjectMap.tokens}\`);
-       console.log(\`fileSystemTree \${maps.fileSystemTree.tokens}\`);
-       console.log(\`folderSystemTreeWithSummaries \${maps.folderSystemTreeWithSummaries.tokens}\`);
+       console.log(\`languageProjectMap \${maps.languageProjectMap.tokens} tokens\`);
+       console.log(\`fileSystemTree \${maps.fileSystemTree.tokens} tokens\`);
+       console.log(\`folderSystemTreeWithSummaries \${maps.folderSystemTreeWithSummaries.tokens} tokens\`);
 
        if (console.log) return;
 
diff --git a/src/cli/query.ts b/src/cli/query.ts
index 8920e00..a34c84d 100644
--- a/src/cli/query.ts
+++ b/src/cli/query.ts
@@ -1,9 +1,9 @@
 import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

-import { writeFileSync } from 'fs';
+import { writeFileSync } from 'node:fs';
 import { agentContext, llms } from '#agent/agentContextLocalStorage';
-import { AgentLLMs } from '#agent/agentContextTypes';
-import { RunAgentConfig } from '#agent/agentRunner';
+import type { AgentLLMs } from '#agent/agentContextTypes';
+import type { RunAgentConfig } from '#agent/agentRunner';
 import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
 import { shutdownTrace } from '#fastify/trace-init/trace-init';
 import { defaultLLMs } from '#llm/services/defaultLlms';
@@ -20,9 +20,9 @@ async function main() {
        console.log(\`Prompt: \${initialPrompt}\`);
 
        const config: RunAgentConfig = {
-               agentName: \`Query: \${initialPrompt}\`,
+               agentName: 'Query',
                llms: agentLLMs,
-               functions: [], //FileSystem,
+               functions: [],
                initialPrompt,
                resumeAgentId,
                humanInLoop: {
@@ -52,9 +52,4 @@ async function main() {
        await shutdownTrace();
 }
 
-main().then(
-       () => console.log('done'),
-       (e) => console.error(e),
-);
+main().catch(console.error);
diff --git a/src/cli/research.ts b/src/cli/research.ts
index 804edf3..0617b9f 100644
--- a/src/cli/research.ts
+++ b/src/cli/research.ts
@@ -1,8 +1,8 @@
 import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

-import { readFileSync } from 'fs';
+import { readFileSync } from 'node:fs';
 
-import { AgentLLMs } from '#agent/agentContextTypes';
+import type { AgentLLMs } from '#agent/agentContextTypes';
 import { startAgentAndWait } from '#agent/agentRunner';
 import { Perplexity } from '#functions/web/perplexity';
 import { PublicWeb } from '#functions/web/web';
diff --git a/src/cli/slack.ts b/src/cli/slack.ts
index 79cd89f..71db654 100644
--- a/src/cli/slack.ts
+++ b/src/cli/slack.ts
@@ -1,9 +1,9 @@
-import { SlackChatBotService } from '#modules/slack/slackChatBotService';
 import { sleep } from '#utils/async-utils';
 import { initApplicationContext } from '../applicationContext';
 
 async function main() {
        await initApplicationContext();
+       const { SlackChatBotService } = await import('../modules/slack/slackModule.cjs');
        const chatbot = new SlackChatBotService();
        await chatbot.initSlack();
        await sleep(60000);
diff --git a/src/cli/summarize.ts b/src/cli/summarize.ts
index 0b7e923..686a2ce 100644
--- a/src/cli/summarize.ts
+++ b/src/cli/summarize.ts
@@ -1,8 +1,8 @@
 import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

-import { writeFileSync } from 'fs';
-import { AgentLLMs } from '#agent/agentContextTypes';
-import { RunAgentConfig } from '#agent/agentRunner';
+import { writeFileSync } from 'node:fs';
+import type { AgentLLMs } from '#agent/agentContextTypes';
+import type { RunAgentConfig } from '#agent/agentRunner';
 import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
 import { shutdownTrace } from '#fastify/trace-init/trace-init';
 import { SummarizerAgent } from '#functions/text/summarizer';
`;

describe.only('parseGitDiff', () => {
    it('should parse the sample git diff output correctly', () => {
        const result = parseGitDiff(sampleDiffOutput);

        // Expected number of files changed
        expect(result).to.be.an('array').with.lengthOf(9);

        // --- Check first file ---
        const file1 = result[0];
        expect(file1.filePath).to.equal('src/cli/files.ts');
        // Removed: expect(file1.diff).to.equal('@@ -1,9 +1,9 @@');
        expect(file1.diff).to.contain('+import { writeFileSync } from \'node:fs\';');
        expect(file1.diff).to.contain('-import { writeFileSync } from \'fs\';');
        expect(file1.diff).to.contain('+import type { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file1.diff).to.contain('-import { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file1.diff).not.to.contain('--- a/src/cli/files.ts'); // Should not include ---/+++ lines
        expect(file1.diff).not.to.contain('index 39592e3..129ef8c 100644'); // Should not include index lines

        // --- Check second file ---
        const file2 = result[1];
        expect(file2.filePath).to.equal('src/cli/functionResolver.ts');
        // Removed: expect(file2.diff).to.equal('@@ -1,11 +1,13 @@');
        expect(file2.diff).to.contain('+import { CustomFunctions } from \'#functions/customFunctions\';');
        expect(file2.diff).to.contain('+import { FileSystemList } from \'#functions/storage/fileSystemList\';');
        expect(file2.diff).to.contain('+import { FileSystemRead } from \'#functions/storage/fileSystemRead\';');
        expect(file2.diff).to.contain('+import { FileSystemWrite } from \'#functions/storage/fileSystemWrite\';');
        expect(file2.diff).to.contain('-import { FileSystemRead } from \'#functions/storage/FileSystemRead\';');
        expect(file2.diff).to.contain('-import { FileSystemWrite } from \'#functions/storage/FileSystemWrite\';');
        expect(file2.diff).to.contain('+import type { LLM } from \'#llm/llm\';');
        expect(file2.diff).to.contain('-import { LLM } from \'#llm/llm\';');

        // Check line starting @@ -19,6 +21,7 @@
        expect(file2.diff).to.contain('@@ -19,6 +21,7 @@');
        expect(file2.diff).to.contain('+       fsl: FileSystemList.name,');

        // Check line starting @@ -26,6 +29,7 @@
        expect(file2.diff).to.contain('@@ -26,6 +29,7 @@');
        expect(file2.diff).to.contain('+       custom: CustomFunctions.name,');

        // Check line starting @@ -56,7 +60,7 @@
        expect(file2.diff).to.contain('@@ -56,7 +60,7 @@');
        expect(file2.diff).to.contain('-                                       .join(\', \')}\\`,');
        expect(file2.diff).to.contain('+                                       .join(\', \')}\\nCheck the alias is correct and the function class is registered in the function registry.\\`,');

        // Check line starting @@ -70,7 +74,7 @@
        expect(file2.diff).to.contain('@@ -70,7 +74,7 @@');
        expect(file2.diff).to.contain('-       // Try exact match first (case insensitive)');
        expect(file2.diff).to.contain('+       // Try exact match first (case-insensitive)');


        // --- Check third file ---
        const file3 = result[2];
        expect(file3.filePath).to.equal('src/cli/gaia.ts');
        // Removed: expect(file3.diff).to.equal('@@ -1,14 +1,15 @@');
        expect(file3.diff).to.contain('+import { promises as fs, readFileSync } from \'node:fs\';');
        expect(file3.diff).to.contain('-import { promises as fs, readFileSync } from \'fs\';');
        expect(file3.diff).to.contain('+import type { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file3.diff).to.contain('-import { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file3.diff).to.contain('+import { FileSystemRead } from \'#functions/storage/fileSystemRead\';');
        expect(file3.diff).to.contain('-import { FileSystemRead } from \'#functions/storage/FileSystemRead\';');
        expect(file3.diff).to.contain('+import { lastText } from \'#llm/llm\';');
        expect(file3.diff).to.contain('+import type { LlmCall } from \'#llm/llmCallService/llmCall\';');
        expect(file3.diff).to.contain('-import { LlmCall } from \'#llm/llmCallService/llmCall\';');

        expect(file3.diff).to.contain('@@ -110,9 +111,9 @@');
        expect(file3.diff).to.contain('-                       .filter((call: LlmCall) => call.responseText.includes(\'<python-code>\'))');
        expect(file3.diff).to.contain('+                       .filter((call: LlmCall) => lastText(call.messages).includes(\'<python-code>\'))');
        expect(file3.diff).to.contain('-                               const match = call.responseText.match(/<python-code>(.*?)<\\/python-code>/s);');
        expect(file3.diff).to.contain('+                               const match = lastText(call.messages).match(/<python-code>(.*?)<\\/python-code>/s);');

        // --- Check fourth file (gen.ts) ---
        const file4 = result[3];
        expect(file4.filePath).to.equal('src/cli/gen.ts');
        // Removed: expect(file4.diff).to.equal('@@ -1,46 +1,30 @@');
        expect(file4.diff).to.contain('+import { writeFileSync } from \'node:fs\';');
        expect(file4.diff).to.contain('-import { writeFileSync } from \'fs\';');
        expect(file4.diff).to.contain('+import { countTokens } from \'#llm/tokens\';');
        expect(file4.diff).to.contain('-import { agentContext, agentContextStorage, createContext } from \'#agent/agentContextLocalStorage\';');
        // ... check more lines if necessary

        // --- Check fifth file (index.ts) ---
        const file5 = result[4];
        expect(file5.filePath).to.equal('src/cli/index.ts');
        // Removed: expect(file5.diff).to.equal('@@ -1,7 +1,7 @@');
        expect(file5.diff).to.contain('+import type { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file5.diff).to.contain('+import type { RunAgentConfig } from \'#agent/agentRunner\';');
        expect(file5.diff).to.contain('-import { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file5.diff).to.contain('-import { RunAgentConfig } from \'#agent/agentRunner\';');
        expect(file5.diff).to.contain('@@ -32,9 +32,9 @@');
        expect(file5.diff).to.contain('+       console.log(\`languageProjectMap \${maps.languageProjectMap.tokens} tokens\`);');
        expect(file5.diff).to.contain('+       console.log(\`fileSystemTree \${maps.fileSystemTree.tokens} tokens\`);');
        expect(file5.diff).to.contain('+       console.log(\`folderSystemTreeWithSummaries \${maps.folderSystemTreeWithSummaries.tokens} tokens\`);');
        expect(file5.diff).to.contain('-       console.log(\`languageProjectMap \${maps.languageProjectMap.tokens}\`);');
        expect(file5.diff).to.contain('-       console.log(\`fileSystemTree \${maps.fileSystemTree.tokens}\`);');
        expect(file5.diff).to.contain('-       console.log(\`folderSystemTreeWithSummaries \${maps.folderSystemTreeWithSummaries.tokens}\`);');


        // --- Check sixth file (query.ts) ---
        const file6 = result[5];
        expect(file6.filePath).to.equal('src/cli/query.ts');
        // Removed: expect(file6.diff).to.equal('@@ -1,9 +1,9 @@');
        expect(file6.diff).to.contain('+import { writeFileSync } from \'node:fs\';');
        expect(file6.diff).to.contain('-import { writeFileSync } from \'fs\';');
        expect(file6.diff).to.contain('+import type { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file6.diff).to.contain('+import type { RunAgentConfig } from \'#agent/agentRunner\';');
        expect(file6.diff).to.contain('-import { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file6.diff).to.contain('-import { RunAgentConfig } from \'#agent/agentRunner\';');
        expect(file6.diff).to.contain('@@ -20,9 +20,9 @@');
        expect(file6.diff).to.contain('-               agentName: \`Query: \${initialPrompt}\`,');
        expect(file6.diff).to.contain('+               agentName: \'Query\',');
        expect(file6.diff).to.contain('-               functions: [], //FileSystem,');
        expect(file6.diff).to.contain('+               functions: [],');
        expect(file6.diff).to.contain('@@ -52,9 +52,4 @@');
        expect(file6.diff).to.contain('+main().catch(console.error);');
        expect(file6.diff).to.contain('-main().then(');
        // ... check deletions

        // --- Check seventh file (research.ts) ---
        const file7 = result[6];
        expect(file7.filePath).to.equal('src/cli/research.ts');
        // Removed: expect(file7.diff).to.equal('@@ -1,8 +1,8 @@');
        expect(file7.diff).to.contain('+import { readFileSync } from \'node:fs\';');
        expect(file7.diff).to.contain('-import { readFileSync } from \'fs\';');
        expect(file7.diff).to.contain('+import type { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file7.diff).to.contain('-import { AgentLLMs } from \'#agent/agentContextTypes\';');

        // --- Check eighth file (slack.ts) ---
        const file8 = result[7];
        expect(file8.filePath).to.equal('src/cli/slack.ts');
        // Removed: expect(file8.diff).to.equal('@@ -1,9 +1,9 @@');
        expect(file8.diff).to.contain('+       const { SlackChatBotService } = await import(\'../modules/slack/slackModule.cjs\');');
        expect(file8.diff).to.contain('-import { SlackChatBotService } from \'#modules/slack/slackChatBotService\';');

        // --- Check ninth file (summarize.ts) ---
        const file9 = result[8];
        expect(file9.filePath).to.equal('src/cli/summarize.ts');
        // Removed: expect(file9.diff).to.equal('@@ -1,8 +1,8 @@');
        expect(file9.diff).to.contain('+import { writeFileSync } from \'node:fs\';');
        expect(file9.diff).to.contain('-import { writeFileSync } from \'fs\';');
        expect(file9.diff).to.contain('+import type { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file9.diff).to.contain('+import type { RunAgentConfig } from \'#agent/agentRunner\';');
        expect(file9.diff).to.contain('-import { AgentLLMs } from \'#agent/agentContextTypes\';');
        expect(file9.diff).to.contain('-import { RunAgentConfig } from \'#agent/agentRunner\';');
    });

    it('should return an empty array for empty input', () => {
        const result = parseGitDiff('');
        expect(result).to.be.an('array').that.is.empty;
    });

    it('should return an empty array if input has no @@ hunk headers', () => {
        const diffOutput = `
diff --git a/file1.txt b/file1.txt
index 123..456 100644
--- a/file1.txt
+++ b/file1.txt
diff --git a/file2.txt b/file2.txt
new file mode 100644
index 0000000..e69de29
`;
        const result = parseGitDiff(diffOutput);
        expect(result).to.be.an('array').that.is.empty;
    });

    it('should handle a single file diff', () => {
        const diffOutput = `
diff --git a/src/cli/files.ts b/src/cli/files.ts
index 39592e3..129ef8c 100644
--- a/src/cli/files.ts
+++ b/src/cli/files.ts
@@ -1,9 +1,9 @@
 import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

-import { writeFileSync } from 'fs';
+import { writeFileSync } from 'node:fs';
 import { agentContext, llms } from '#agent/agentContextLocalStorage';
-import { AgentLLMs } from '#agent/agentContextTypes';
-import { RunAgentConfig } from '#agent/agentRunner';
+import type { AgentLLMs } from '#agent/agentContextTypes';
+import type { RunAgentConfig } from '#agent/agentRunner';
 import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
 import { shutdownTrace } from '#fastify/trace-init/trace-init';
 import { defaultLLMs } from '#llm/services/defaultLlms';
`;
        const result = parseGitDiff(diffOutput);
        expect(result).to.be.an('array').with.lengthOf(1);
        expect(result[0].filePath).to.equal('src/cli/files.ts');
        // Removed: expect(result[0].diff).to.equal('@@ -1,9 +1,9 @@');
        expect(result[0].diff).to.contain('+import { writeFileSync } from \'node:fs\';');
        expect(result[0].newFile).to.be.false; // Add check for newFile flag
        expect(result[0].deletedFile).to.be.false; // Add check for deletedFile flag
    });

    it('should handle diffs with only additions (new file)', () => {
        const diffOutput = `
diff --git a/new_file.txt b/new_file.txt
new file mode 100644
index 0000000..ab12345
--- /dev/null
+++ b/new_file.txt
@@ -0,0 +1,3 @@
+This is line 1.
+This is line 2.
+This is line 3.
`;
        const result = parseGitDiff(diffOutput);
        expect(result).to.be.an('array').with.lengthOf(1);
        expect(result[0].filePath).to.equal('new_file.txt');
        expect(result[0].diff).to.equal('@@ -0,0 +1,3 @@\n+This is line 1.\n+This is line 2.\n+This is line 3.');
        expect(result[0].newFile).to.be.true;
        expect(result[0].deletedFile).to.be.false;
        expect(result[0].oldPath).to.equal('/dev/null');
        expect(result[0].newPath).to.equal('new_file.txt');
    });

    it('should handle diffs with only deletions (deleted file)', () => { // Updated description
        const diffOutput = `
diff --git a/deleted_file.log b/deleted_file.log
deleted file mode 100644
index fedcba9..0000000
--- a/deleted_file.log
+++ /dev/null
@@ -1,2 +0,0 @@
-Log entry 1
-Log entry 2
`;
        const result = parseGitDiff(diffOutput);
        // Expect one entry for the deleted file
        expect(result).to.be.an('array').with.lengthOf(1);
        expect(result[0].filePath).to.equal('deleted_file.log'); // Check the correct path property (old path for deleted)
        expect(result[0].oldPath).to.equal('deleted_file.log');
        expect(result[0].newPath).to.equal('/dev/null');
        expect(result[0].deletedFile).to.be.true;
        expect(result[0].newFile).to.be.false;
        expect(result[0].diff).to.equal('@@ -1,2 +0,0 @@\n-Log entry 1\n-Log entry 2');
    });

});
