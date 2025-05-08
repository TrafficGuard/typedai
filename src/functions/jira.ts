import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import axios, { type AxiosInstance } from 'axios';
import { llms } from '#agent/agentContextLocalStorage';
import { agentStorageDir } from '#app/appVars';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { getJiraIssueType } from '#functions/jiraIssueType';
import { logger } from '#o11y/logger';
import { currentUser, functionConfig } from '#user/userService/userContext';
import { envVar } from '#utils/env-var';
import { escapeXml, formatXmlContent } from '#utils/xml-utils';
import { cacheRetry } from '../cache/cacheRetry';

export interface JiraConfig {
	baseUrl: string;
	email: string;
	token: string;
}

@funcClass(__filename)
export class Jira {
	instance: AxiosInstance | undefined;

	private axios(): AxiosInstance {
		if (!this.instance) {
			const config: JiraConfig = functionConfig(Jira) as JiraConfig;
			const baseUrl = config.baseUrl || envVar('JIRA_BASE_URL');
			const email = config.email || process.env.JIRA_EMAIL || currentUser()?.email;
			const apiToken = config.token || envVar('JIRA_API_TOKEN');

			if (!baseUrl) throw new Error('Jira baseUrl must be provided from the user profile or JIRA_BASE_URL environment variable');
			if (!apiToken) throw new Error('Jira apiToken must be provided from the user profile or JIRA_API_TOKEN environment variable');
			if (!apiToken)
				throw new Error('Jira email must be provided from the user profile or JIRA_EMAIL environment variable (or currentUser() for workflow authors)');

			this.instance = axios.create({
				baseURL: baseUrl,
				headers: {
					Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
					'Content-Type': 'application/json ',
				},
			});
		}
		return this.instance;
	}

	/**
	 * Gets the details of a JIRA issue (title, description, comments, attachments)
	 * @param {string} issueId - the issue id (e.g. XYZ-123)
	 * @returns {Promise<string>} the issue details
	 */
	@func()
	async getJiraDetails(issueId: string): Promise<string> {
		if (!issueId) throw new Error('issueId is required');

		try {
			const response = await this.axios().get(`/rest/api/latest/issue/${issueId}`);
			const fields = response.data.fields;

			let xml = `<jira-issue id="${issueId}">\n`;
			xml += `  <summary>${formatXmlContent(fields.summary)}</summary>\n`;
			xml += `  <description>${formatXmlContent(fields.description)}</description>\n`;

			// Add comments
			if (fields.comment?.comments?.length > 0) {
				xml += '  <comments>\n';
				for (const comment of fields.comment.comments) {
					const author = comment.author?.emailAddress || comment.author?.displayName || 'Unknown';
					const created = comment.created || '';
					const updated = comment.updated || '';
					const body = comment.body || '';
					const isUpdated = created !== updated;
					xml += `    <comment author="${author}" created="${created}" ${isUpdated ? `updated="${updated}"` : ''}>\n`;
					xml += `      ${formatXmlContent(body)}\n`;
					xml += '    </comment>\n';
				}
				xml += '  </comments>\n';
			} else {
				xml += '  <comments />\n';
			}

			// Download attachments in parallel and build XML
			if (fields.attachment?.length > 0) {
				xml += '  <attachments>\n';
				const agentPath = agentStorageDir();
				const dirPath = join(agentPath, 'jira', issueId);
				await fs.mkdir(dirPath, { recursive: true }); // Ensure base directory exists once

				const downloadPromises = fields.attachment.map(async (attachment: any) => {
					const filename = attachment.filename as string;
					const contentUrl = attachment.content as string;
					const mimeType = attachment.mimeType as string;
					const size = attachment.size as number;
					const attachmentPath = join(dirPath, filename);

					try {
						const attachmentResponse = await this.axios().get(contentUrl, { responseType: 'arraybuffer' });
						const buffer = Buffer.from(attachmentResponse.data, 'binary');
						await fs.writeFile(attachmentPath, buffer);
						return { filename, mimeType, size, attachmentPath };
					} catch (e: any) {
						logger.warn(e, `Failed to download attachment ${filename} from ${contentUrl}`);
						// Return metadata even on failure, but mark status as error
						return { filename, mimeType, size, attachmentPath: '[Not available - download error]' };
					}
				});

				const results = await Promise.allSettled(downloadPromises);

				results.forEach((result) => {
					if (result.status === 'fulfilled') {
						const { filename, mimeType, size, downloadStatus, attachmentPath } = result.value;
						xml += `    <attachment filename="${escapeXml(filename)}" mimeType="${escapeXml(mimeType)}" size="${size}b" path="${escapeXml(attachmentPath)}"`;
						xml += ' />\n';
					} else {
						logger.error(result.reason, 'Unexpected error during attachment processing promise.'); // Shouldn't happen as we catch errors
					}
				});

				xml += '  </attachments>\n';
			} else {
				xml += '  <attachments />\n';
			}

			xml += '</jira-issue>';

			return xml;
		} catch (error) {
			logger.error(error, `Error fetching Jira ${issueId} description`);
			throw error;
		}
	}

	/**
	 * Creates a new JIRA issue
	 * @param projectKey The Jira project key (usually a short capitalized code)
	 * @param title The issue summary
	 * @param description The issue description in Markdown format
	 * @param reporterEmail The email address of the user who be assigned as the reporter for this issue.
	 * @param relatedContentForIssueTypeDetection user content (chat messages etc) which could assist with the issue type detection
	 * @returns {Promise<{key: string, url: string}>} The created issue key and URL
	 */
	@func()
	@cacheRetry({ retries: 1, backOffMs: 1000 })
	async createIssue(
		projectKey: string,
		title: string,
		description: string,
		reporterEmail: string,
		relatedContentForIssueTypeDetection?: string,
	): Promise<{ key: string; url: string }> {
		if (!projectKey) throw new Error('projectKey is required');
		if (!title) throw new Error('summary is required');
		if (!description) throw new Error('description is required');

		// Lookup the user id
		const userSearchResponse = await this.axios().get('/rest/api/latest/user/search', {
			params: {
				query: reporterEmail,
			},
		});
		const users: number = userSearchResponse.data.length;
		if (users !== 1) throw new Error(`Searching for Jira user by email ${reporterEmail} returned ${users} results, when 1 is required.`);
		const reporterId = userSearchResponse.data[0].accountId;

		// Reformat the description and lookup the issue type
		const [issueType, formattedDescription] = await Promise.all([
			getJiraIssueType(projectKey, title, description, relatedContentForIssueTypeDetection),
			convertFormatting(description),
		]);

		// Create the issue
		const response = await this.axios().post('issue', {
			fields: {
				project: {
					key: projectKey,
				},
				summary: title,
				description: formattedDescription,
				issuetype: {
					id: issueType,
				},
				reporter: {
					id: reporterId,
				},
			},
		});
		logger.info(response.data);

		const key = response.data.key;
		// Create url in the format https://account.atlassian.net/browse/ABC-123
		let url = this.instance.defaults.baseURL;
		url = `${url.substring(0, url.indexOf('t/') + 1)}/browse/${key}`;

		return { key, url };
	}

	async getBacklog(boardId: string): Promise<any> {
		const response = await this.axios().get(`/rest/agile/1.0/board/${boardId}/backlog?maxResults=250`);
		const issues = response.data.issues;

		for (const issue of issues) {
			try {
				const fields = issue.fields;
				const issueId = issue.key;
				const parent = fields.parent?.fields.summary;
				const epic = fields.epic?.name;
				const description = fields.description;
				const title = fields.summary;

				console.log(`<jira-${issueId}>`);
				console.log(`  <title>${title}</title>`);
				console.log(`  <description>${description}</description>`);
				if (parent || epic) console.log(`  <parent>${parent || epic}</parent>`);
				console.log(`</jira-${issueId}>\n`);
			} catch (e) {
				console.log(issue);
				console.log(e);
			}
		}
		return issues;
	}

	// /**
	//  * Search JIRA issues
	//  * @param {string} query
	//  * @returns {Promise<string>} the serach results
	//  */
	// @func
	// @cacheRetry()
	// async search(query: string): Promise<string> {
	// 	try {
	// 		const response = await this.axios().get(`/issue/picker?query=${encodeURIComponent(query)}`);
	// 		return response.data.fields.description;
	// 	} catch (error) {
	// 		console.error('Error searching issues:', error);
	// 		throw error;
	// 	}
	// }
}

/**
 * Converts Markdown to the Jira text formatting notation
 * https://jira.atlassian.com/secure/WikiRendererHelpAction.jspa?section=all
 * @param markdown
 */
async function convertFormatting(markdown: string): Promise<string> {
	const prompt = `<jira-text-formatting>
Headings

To create a header, place "hn. " at the start of the line (where n can be a number from 1-6).

<notation>
h1. Biggest heading
</notation>
<comment>
Biggest heading
</comment>

<notation>
h2. Bigger heading
</notation>
<comment>
Bigger heading
</comment>

<notation>
h3. Big heading
</notation>
<comment>
Big heading
</comment>

<notation>
h4. Normal heading
</notation>
<comment>
Normal heading
</comment>

<notation>
h5. Small heading
</notation>
<comment>
Small heading
</comment>

<notation>
h6. Smallest heading
</notation>
<comment>
Smallest heading
</comment>

Text Effects

Text effects are used to change the formatting of words and sentences.

<notation>
*strong*
</notation>
<comment>
Makes text strong.
</comment>

<notation>
_emphasis_
</notation>
<comment>
Makes text emphasis.
</comment>

<notation>
??citation??
</notation>
<comment>
Makes text in citation.
</comment>

<notation>
-deleted-
</notation>
<comment>
Makes text as deleted.
</comment>

<notation>
+inserted+
</notation>
<comment>
Makes text as inserted.
</comment>

<notation>
^superscript^
</notation>
<comment>
Makes text in superscript.
</comment>

<notation>
~subscript~
</notation>
<comment>
Makes text in subscript.
</comment>

<notation>
{}
</notation>
<comment>
Makes text as monospaced.
</comment>

<notation>
bq. Some block quoted text
</notation>
<comment>
To make an entire paragraph into a block quotation, place "bq. " before it.
</comment>

<notation>
{quote}
here is quotable content to be quoted
{quote}
</notation>
<comment>
Quote a block of text that's longer than one paragraph.
</comment>

<notation>
{color:red}
look ma, red text!
{color}
</notation>
<comment>
Changes the color of a block of text.
</comment>

Text Breaks

Most of the time, explicit paragraph breaks are not required - The wiki renderer will be able to paginate your paragraphs properly.

<notation>
(empty line)
</notation>
<comment>
Produces a new paragraph
</comment>

<notation>
\\\\
</notation>
<comment>
Creates a line break. Not often needed, most of the time the wiki renderer will guess new lines for you appropriately.
</comment>

<notation>
----
</notation>
<comment>
Creates a horizontal ruler.
</comment>

<notation>
---
</notation>
<comment>
Produces — symbol.
</comment>

<notation>
--
</notation>
<comment>
Produces – symbol.
</comment>

Links

Learning how to create links quickly is important.

<notation>
[#anchor]
[^attachment.ext]
</notation>
<comment>
Creates an internal hyperlink to the specified anchor or attachment. Appending the '#' sign followed by an anchor name will lead into a specific bookmarked point of the desired page. Having the '^' followed by the name of an attachment will lead into a link to the attachment of the current issue.
</comment>

<notation>
[http://jira.atlassian.com]
[Atlassian|http://atlassian.com]
</notation>
<comment>
Creates a link to an external resource, special characters that come after the URL and are not part of it must be separated with a space.
</comment>

<notation>
[mailto:legendaryservice@atlassian.com]
</notation>
<comment>
Creates a link to an email address, complete with mail icon.
</comment>

<notation>
[file:///c:/temp/foo.txt]
[file:///z:/file/on/network/share.txt]
</notation>
<comment>
Creates a download link to a file on your computer or on a network share that you have mapped to a drive.
</comment>

<notation>
{anchor:anchorname}
</notation>
<comment>
Creates a bookmark anchor inside the page.
</comment>

<notation>
[~username]
</notation>
<comment>
Creates a link to the user profile page of a particular user, with a user icon and the user's full name.
</comment>

Lists

Lists allow you to present information as a series of ordered items.

<notation>
* some
* bullet
** indented
** bullets
* points
</notation>
<comment>
A bulleted list (must be in first column). Use more (**) for deeper indentations.
</comment>

<notation>
- different
- bullet
- types
</notation>
<comment>
A list item (with -), several lines create a single list.
</comment>

<notation>
# a
# numbered
# list
</notation>
<comment>
A numbered list (must be in first column). Use more (##, ###) for deeper indentations.
</comment>

<notation>
# a
# numbered
#* with
#* nested
#* bullet
# list
</notation>
<comment>
You can create mixed nested lists
</comment>

Images

Images can be embedded into a wiki renderable field from attached files or remote sources.

<notation>
!http://www.host.com/image.gif!
or
!attached-image.gif!
</notation>
<comment>
Inserts an image into the page.
</comment>

<notation>
!image.jpg|thumbnail!
</notation>
<comment>
Insert a thumbnail of the image into the page (only works with images that are attached to the page).
</comment>

<notation>
!image.gif|align=right, vspace=4!
</notation>
<comment>
For any image, you can specify attributes of the image tag as a comma separated list of name=value pairs.
</comment>

Tables

Tables allow you to organise content in rows and columns, with a header row if required.

<notation>
||heading 1||heading 2||heading 3||
|col A1|col A2|col A3|
|col B1|col B2|col B3|
</notation>
<comment>
Makes a table. Use double bars for a table heading row.
</comment>

Advanced Formatting

More advanced text formatting.

<notation>
{noformat}
preformatted piece of text so *no* further _formatting_ is done here
{noformat}
</notation>
<comment>
Makes a preformatted block of text with no syntax highlighting.
</comment>

<notation>
{panel}
Some text
{panel}
</notation>
<comment>
Embraces a block of text within a panel.
</comment>

<notation>
{code:title=Bar.java|borderStyle=solid}
// Some comments here
public String getFoo()
{
    return foo;
}
{code}
</notation>
<comment>
Makes a preformatted block of code with syntax highlighting.
</comment>

Misc

Various other syntax highlighting capabilities.

<notation>
\\X
</notation>
<comment>
Escape special character X (i.e. {)
</comment>

<notation>
:) :( :P :D ;) (y) (n) (i) (/) (x) (!)
</notation>
<comment>
Graphical emoticons (smileys)
</comment>

</jira-text-formatting>

<description-markdown>
${markdown}
</description-markdown>

Your task is to convert the text in the description-markdown tag from regular Markdown to the Jira text formatting.
Output only the converted text.
`;
	return await llms().medium.generateText(prompt, { temperature: 0.3 });
}
