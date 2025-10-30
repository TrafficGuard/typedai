/**
 * Lazy-loading module for all function classes.
 * This avoids circular dependencies and reduces startup time by only loading
 * function classes when they are actually called (using lazy getters).
 *
 * The key is that require() happens inside the getter, which is only invoked
 * when the property is accessed - AFTER all module initialization is complete.
 *
 * Example usage:
 *   const { default: functionModules } = await import('../functions/functionModules.cjs');
 *   const markdown = await new functionModules.web.PublicWeb().getWebPage(url);
 */

module.exports = {
	// Agent Functions
	get agentFeedback() {
		return require('../agent/autonomous/functions/agentFeedback.ts');
	},
	get fileSystemTree() {
		return require('../agent/autonomous/functions/fileSystemTree.ts');
	},
	get liveFiles() {
		return require('../agent/autonomous/functions/liveFiles.ts');
	},

	// Cloud Functions - Google
	get bigQuery() {
		return require('./cloud/google/bigquery.ts');
	},
	get composerAirflow() {
		return require('./cloud/google/composerAirflow.ts');
	},
	get composerAirflowDagDebugAgent() {
		return require('./cloud/google/composerAirflowDagDebugAgent.ts');
	},
	get composerDagDebugger() {
		return require('./cloud/google/composerAirflowDebugger2.ts');
	},
	get googleCloud() {
		return require('./cloud/google/google-cloud.ts');
	},
	get googleCloudSecurityCommandCenter() {
		return require('./cloud/google/security-command-center.ts');
	},

	// Core Functions
	get commandLine() {
		return require('./commandLine.ts');
	},
	get confluence() {
		return require('./confluence.ts');
	},
	get customFunctions() {
		return require('./customFunctions.ts');
	},
	get deepThink() {
		return require('./deepThink.ts');
	},
	get googleCalendar() {
		return require('./googleCalendar.ts');
	},
	get image() {
		return require('./image.ts');
	},
	get jira() {
		return require('./jira.ts');
	},
	get llmTools() {
		return require('./llmTools.ts');
	},
	get subProcess() {
		return require('./subProcess.ts');
	},
	get supportKnowledgebase() {
		return require('./supportKnowledgebase.ts');
	},
	get tempo() {
		return require('./tempo.ts');
	},
	get testFunctions() {
		return require('./testFunctions.ts');
	},

	// Email Functions
	get gmail() {
		return require('./email/gmail.ts');
	},

	// SCM Functions
	get git() {
		return require('./scm/git.ts');
	},
	get gitHub() {
		return require('./scm/github.ts');
	},
	get gitLab() {
		return require('./scm/gitlab.ts');
	},
	get gitLabCodeReview() {
		return require('./scm/gitlabCodeReview.ts');
	},

	// Storage Functions
	get fileSystemList() {
		return require('./storage/fileSystemList.ts');
	},
	get fileSystemRead() {
		return require('./storage/fileSystemRead.ts');
	},
	get fileSystemService() {
		return require('./storage/fileSystemService.ts');
	},
	get fileSystemWrite() {
		return require('./storage/fileSystemWrite.ts');
	},
	get localFileStore() {
		return require('./storage/localFileStore.ts');
	},

	// Text Functions
	get summarizer() {
		return require('./text/summarizer.ts');
	},

	// Web Functions
	get perplexity() {
		return require('./web/perplexity.ts');
	},
	get web() {
		return require('./web/web.ts');
	},
	get webResearch() {
		return require('./web/webResearch.ts');
	},

	// SWE Functions
	get codeEditingAgent() {
		return require('../swe/codeEditingAgent.ts');
	},
	get codeFunctions() {
		return require('../swe/codeFunctions.ts');
	},
	get morphCodeAgent() {
		return require('../swe/morph/morphCoder.ts');
	},
	get morphEditor() {
		return require('../swe/morph/morphEditor.ts');
	},
	get npmPackages() {
		return require('../swe/lang/nodejs/npmPackages.ts');
	},
	get softwareDeveloperAgent() {
		return require('../swe/softwareDeveloperAgent.ts');
	},
	get typescriptTools() {
		return require('../swe/lang/nodejs/typescriptTools.ts');
	},

	// Slack/Chat Functions
	get slack() {
		return require('../modules/slack/slack.ts');
	},
	get slackAPI() {
		return require('../modules/slack/slackApi.ts');
	},
};
