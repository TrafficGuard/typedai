import { AgentFeedback } from '#agent/agentFeedback';
import { LiveFiles } from '#agent/liveFiles';
import { BigQuery } from '#functions/cloud/google/bigquery';
import { GoogleCloud } from '#functions/cloud/google/google-cloud';
import { CustomFunctions } from '#functions/customFunctions';
import { ImageGen } from '#functions/image';
import { Jira } from '#functions/jira';
import { GitHub } from '#functions/scm/github';
import { GitLab } from '#functions/scm/gitlab';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { FileSystemWrite } from '#functions/storage/fileSystemWrite';
import { LocalFileStore } from '#functions/storage/localFileStore';
import { LlmTools } from '#functions/util';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { Slack } from '#modules/slack/slack';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { NpmPackages } from '#swe/lang/nodejs/npmPackages';
import { TypescriptTools } from '#swe/lang/nodejs/typescriptTools';
import { SoftwareDeveloperAgent } from '#swe/softwareDeveloperAgent';

/**
 * Add any function classes to be made available here to ensure their function schemas are registered
 * @return the constructors for the function classes
 */
export function functionRegistry(): Array<new () => any> {
	return [
		AgentFeedback,
		CodeEditingAgent,
		FileSystemList,
		FileSystemRead,
		FileSystemWrite,
		LocalFileStore,
		LiveFiles,
		GitLab,
		// GitHub, // Error: More than one function classes found implementing SourceControlManagement
		GoogleCloud,
		Jira,
		Perplexity,
		Slack,
		SoftwareDeveloperAgent,
		LlmTools,
		ImageGen,
		PublicWeb,
		NpmPackages,
		TypescriptTools,
		BigQuery,
		CustomFunctions,
		// Add your own classes below this line
	];
}
