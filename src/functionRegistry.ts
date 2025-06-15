import { AgentFeedback } from '#agent/autonomous/functions/agentFeedback';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { BigQuery } from '#functions/cloud/google/bigquery';
import { GoogleCloud } from '#functions/cloud/google/google-cloud';
import { CommandLineInterface } from '#functions/commandLine';
import { CustomFunctions } from '#functions/customFunctions';
import { DeepThink } from '#functions/deepThink';
import { ImageGen } from '#functions/image';
import { Jira } from '#functions/jira';
import { LlmTools } from '#functions/llmTools';
import { Git } from '#functions/scm/git';
import { GitHub } from '#functions/scm/github';
import { GitLab } from '#functions/scm/gitlab';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { FileSystemWrite } from '#functions/storage/fileSystemWrite';
import { LocalFileStore } from '#functions/storage/localFileStore';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { type ToolType, hasGetToolType } from '#shared/agent/functions';
import { Slack } from '#slack/slack';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { CodeFunctions } from '#swe/codeFunctions';
import { NpmPackages } from '#swe/lang/nodejs/npmPackages';
import { TypescriptTools } from '#swe/lang/nodejs/typescriptTools';
import { SoftwareDeveloperAgent } from '#swe/softwareDeveloperAgent';

// Add any function classes to be made available here to ensure their function schemas are registered
const FUNCTIONS = [
	AgentFeedback,
	CodeEditingAgent,
	DeepThink,
	FileSystemTree,
	FileSystemRead,
	FileSystemWrite,
	FileSystemList,
	LocalFileStore,
	LiveFiles,
	GitLab,
	GitHub,
	Git,
	CommandLineInterface,
	GoogleCloud,
	Jira,
	Perplexity,
	Slack,
	SoftwareDeveloperAgent,
	CodeFunctions,
	LlmTools,
	ImageGen,
	PublicWeb,
	NpmPackages,
	TypescriptTools,
	BigQuery,
	CustomFunctions,
	// Add your own classes below this line
];

/**
 * @return the constructors for the function classes
 */
export function functionRegistry(): Array<new () => any> {
	return FUNCTIONS;
}

/**
 * @param type
 * @return all the registered function classes which match the given type.
 */
export function getFunctionsByType(type: ToolType): Array<any> {
	const functions = [];
	for (const func of FUNCTIONS) {
		const tool = new func();
		if (hasGetToolType(tool)) {
			const toolType = tool.getToolType();
			if (toolType === type) functions.push(tool);
		}
	}
	return functions;
}
