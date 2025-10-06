import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { GitLab } from '#functions/scm/gitlab';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { defaultLLMs } from '#llm/services/defaultLlms';

let docsPath: string | undefined;

async function docsProjectPath(): Promise<string> {
	if (!docsPath) {
		const supportDocsLocalPath = process.env.SUPPORT_DOCS_LOCAL_PATH?.trim() || '';
		const hasLocalDocs = Boolean(supportDocsLocalPath && existsSync(supportDocsLocalPath));
		const hasSupportDocs = hasLocalDocs || Boolean(process.env.SUPPORT_DOCS_PROJECT?.trim());
		if (!hasSupportDocs) {
			docsPath = '';
		} else if (supportDocsLocalPath) {
			docsPath = supportDocsLocalPath;
		} else {
			docsPath = await new GitLab().cloneProject(process.env.SUPPORT_DOCS_PROJECT ?? '');
		}
	}
	return docsPath;
}

@funcClass(__filename)
export class SupportKnowledgebase {
	/**
	 * @returns the core documentation which must be known to resolve support requests
	 */
	@func()
	async getCoreDocumentation(): Promise<string> {
		const docsPath = await docsProjectPath();
		if (!docsPath) return '';

		return await readFile(join(docsPath, 'overview.md'), 'utf-8');
	}

	/**
	 * @returns the search various sources (docs, wiki, issues etc) for content relevant to the support request.
	 */
	@func()
	async searchDocs(supportRequest: string): Promise<string> {
		// Search confluence, jira, support requests etc
		const docsPath = await docsProjectPath();
		if (!docsPath) return '';

		const fss = new FileSystemService(join(docsPath, 'kb'));
		const kb = await fss.getFileContentsRecursivelyAsXml('./');
		const prompt = `
<knowledgebase>
${kb}
</knowledgebase>

<support-request>
${supportRequest}
</support-request>

From the knowledgebase we want to extract the relevant information for the support request. 
Ouput verbatim any relevant information from the knowledgebase.
You may only quote information from the knowledgebase wrapped in XML tags.
Do not output any other content. Skip small talk.`;
		return await defaultLLMs().medium.generateText(prompt, { id: 'Support KB search' });
	}
}
