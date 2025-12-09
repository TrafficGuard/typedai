import { llms } from '#agent/agentContextUtils';
import { func, funcClass } from '#functionSchema/functionDecorators';

/**
 * Inspired from Wolfwoef's post at https://www.reddit.com/r/ClaudeAI/comments/1fwk7k1/comment/lqf7w5w/?context=3
 */
@funcClass(__filename)
export class SummarizerAgent {
	/**
	 * Summarizes a document/transcript into the key details
	 * @param transcriptOrDocumentText
	 * @param expandIterations - number of times to expand the output
	 */
	@func()
	async summarizeTranscript(transcriptOrDocumentText: string, expandIterations = 1): Promise<string> {
		// Step 1: Initial summary with cache marker
		const initialPrompt = `
You are an expert summarizer tasked with creating a concise yet comprehensive summary of a transcript.

<transcript>
${transcriptOrDocumentText}
</transcript>

Please provide a comprehensive and detailed summary of the following conversation. Your summary should :

1. Capture all significant points, arguments, and ideas discussed, regardless of how minor they may seem.
2. Include any decisions made, action items proposed, or conclusions reached.
3. ention all participants and their key contributions.
4. Note any questions raised, even if they were not fully addressed.
5. Highlight any areas of agreement or disagreement among participants.
6. Include relevant context, background information, or references made during the discussion.
7. Maintain the chronological flow of the conversation where it's important for understanding.
8. Use subheadings or bullet points to organize information if it helps with clarity.
9. Do not omit any topic or subtopic discussed, even if it seems tangential.
10. If certain points were emphasized or repeated, make note of this emphasis in your summary.

Format your response as follows:
<response>
[Outine the key sections of the transcript/document]
<result>
[Provide the detailed summary covering the 10 items listed above]
</result>
</response>`;

		let currentSummary = await llms().medium.generateText(initialPrompt, { id: 'Summarize initial' });

		// Step 2: Expand on the summary for the specified number of iterations
		for (let i = 0; i < expandIterations; i++) {
			const expandPrompt = `
You are an expert analyst tasked with expanding and enriching a summary of a transcript. Here's the current summary:

<transcript>
${transcriptOrDocumentText}
</transcript>

<current-summary>
${currentSummary}
</current-summary>

The current-summary initial instructions were:
1. Capture all significant points, arguments, and ideas discussed, regardless of how minor they may seem.
2. Include any decisions made, action items proposed, or conclusions reached.
3. ention all participants and their key contributions.
4. Note any questions raised, even if they were not fully addressed.
5. Highlight any areas of agreement or disagreement among participants.
6. Include relevant context, background information, or references made during the discussion.
7. Maintain the chronological flow of the conversation where it's important for understanding.
8. Use subheadings or bullet points to organize information if it helps with clarity.
9. Do not omit any topic or subtopic discussed, even if it seems tangential.
10. If certain points were emphasized or repeated, make note of this emphasis in your summary.

Please enhance this summary by following these steps:
1. Identify any important details, examples, or context that might have been missed in the previous summary.
2. Add nuance to the main points, explaining any complex ideas or concepts.
3. Provide additional context for key decisions or conclusions.
4. Elaborate on the potential implications of unresolved issues.
5. Include any relevant quotes that support the main points (if applicable).

Respond in the following format:
<response>

[Identify important details which are not in the summary, and explain why they are important and where in the summary to insert them.]

<result>
[The enhanced, detailed summary]
</result>
</response>`;

			currentSummary = await llms().medium.generateTextWithResult(expandPrompt, { id: 'Summarize expand' });
		}

		return currentSummary;
	}
}
