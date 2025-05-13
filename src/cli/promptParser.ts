import type { ImagePart, TextPart, UserContent } from 'ai';
import type { ImagePartExt, UserContentExt } from '#shared/model/llm.model';

export interface ParsedPrompt {
	textPrompt: string;
	imageAttachments: ImagePart[];
	userContent: UserContent;
}

/**
 * Parses a raw prompt string, separating text from image URLs specified with "IMG:".
 * Constructs the UserContent object for LlmMessage.
 * @param rawPrompt The raw input prompt string.
 * @returns An object containing the text prompt, image attachments, and the combined UserContent.
 */
export function parsePromptWithImages(rawPrompt: string): ParsedPrompt {
	const lines = rawPrompt.split('\n');
	const textParts: string[] = [];
	const imageAttachments: ImagePartExt[] = [];

	for (const line of lines) {
		if (line.startsWith('IMG:')) {
			const urlString = line.substring(4).trim();
			if (urlString) {
				try {
					const url = new URL(urlString);
					// TODO: Add filename and size if derivable or needed for specific LLMs/logging
					imageAttachments.push({ type: 'image', image: url.toString() });
				} catch (e) {
					console.warn(`Invalid image URL skipped: ${urlString}`);
				}
			}
		} else {
			textParts.push(line);
		}
	}

	const textPrompt = textParts.join('\n');
	let userContent: UserContentExt;

	if (imageAttachments.length > 0) {
		const contentParts: Array<TextPart | ImagePartExt> = [{ type: 'text', text: textPrompt }];
		contentParts.push(...imageAttachments);
		userContent = contentParts;
	} else {
		userContent = textPrompt;
	}

	return { textPrompt, imageAttachments, userContent };
}
