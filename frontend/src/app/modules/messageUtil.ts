import { Attachment } from 'app/modules/message.types';
import { AssistantContentExt, FilePartExt, ImagePartExt, TextPart, UserContentExt, TextPartExt } from '#shared/llm/llm.model';
import type { LanguageModelV2Source } from '@ai-sdk/provider';

// Helper function to convert File to base64 string (extracting only the data part)
async function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.readAsDataURL(file);
		reader.onload = () => {
			const result = reader.result as string;
			const commaIndex = result.indexOf(',');
			if (commaIndex === -1) {
				resolve(''); // Return empty string if not a valid data URI structure or empty file
				return;
			}
			resolve(result.substring(commaIndex + 1));
		};
		reader.onerror = (error) => reject(error);
	});
}

/**
 * Converts a File object into an Attachment object, generating a preview URL for images.
 * @param file The File object to convert.
 * @returns A Promise that resolves to an Attachment object.
 */
export async function fileToAttachment(file: File): Promise<Attachment> {
	const attachment: Attachment = {
		type: file.type.startsWith('image/') ? 'image' : 'file',
		filename: file.name,
		size: file.size,
		data: file,
		mediaType: file.type,
		previewUrl: undefined,
	};

	if (attachment.type === 'image' && file.type.startsWith('image/')) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e: ProgressEvent<FileReader>) => {
				attachment.previewUrl = e.target?.result as string;
				resolve(attachment);
			};
			reader.onerror = (error) => {
				console.error(`Error reading file ${file.name}:`, error);
				// Resolve with attachment even if preview generation fails, previewUrl will be undefined
				resolve(attachment);
			};
			reader.readAsDataURL(file);
		});
	}
	return Promise.resolve(attachment);
}

/**
 * Converts an array of Attachments and optional text into UserContentExt format.
 * @param attachments An array of Attachment objects.
 * @param text An optional text string.
 * @returns UserContentExt representing the combined attachments and text.
 */
export async function attachmentsAndTextToUserContentExt(attachments: Attachment[], text: string | null | undefined): Promise<UserContentExt> {
	const parts: Array<TextPart | ImagePartExt | FilePartExt> = [];

	if (text && text.trim() !== '') {
		parts.push({ type: 'text', text: text.trim() } as TextPart); // Cast to TextPart from shared model
	}

	for (const attachment of attachments) {
		if (attachment.type === 'image') {
			const imageBase64 = attachment.data ? await fileToBase64(attachment.data) : '';
			const imagePart: ImagePartExt = {
				type: 'image',
				image: imageBase64, // Required: base64 string
				mediaType: attachment.mediaType, // Optional in shared ImagePart, but good to provide
				filename: attachment.filename,
				size: attachment.size,
				externalURL: attachment.previewUrl && !attachment.previewUrl.startsWith('data:') ? attachment.previewUrl : undefined,
			};
			parts.push(imagePart);
		} else if (attachment.type === 'file') {
			const fileBase64 = attachment.data ? await fileToBase64(attachment.data) : '';
			const filePart: FilePartExt = {
				type: 'file',
				data: fileBase64, // Required: base64 string
				mediaType: attachment.mediaType, // Required
				filename: attachment.filename,
				size: attachment.size,
				externalURL: attachment.previewUrl && !attachment.previewUrl.startsWith('data:') ? attachment.previewUrl : undefined,
			};
			parts.push(filePart);
		}
	}

	if (parts.length === 0 && (!text || text.trim() === '')) {
		return []; // No text and no attachments
	}

	if (parts.length === 1 && parts[0].type === 'text') {
		return (parts[0] as TextPart).text; // Only text, no attachments
	}

	return parts; // Mixed content or only attachments
}

/**
 * Converts UserContentExt format back into an array of Attachments and a text string.
 * @param content The UserContentExt data.
 * @returns An object containing an array of Attachments, a text string, reasoning, and sources.
 */
export function userContentExtToAttachmentsAndText(
	content: UserContentExt | AssistantContentExt | undefined, sources: LanguageModelV2Source[] = []
): { attachments: Attachment[]; text: string; reasoning: string } {
	let text = '';
	let reasoning = '';
	const attachments: Attachment[] = [];
	let totalSourcesCount = 0;

	if (!content) {
		return { attachments, text, reasoning };
	}

	if (typeof content === 'string') {
		text = linkCitations(content, sources);
		return { attachments, text, reasoning };
	}

	if (Array.isArray(content)) {
		for (const part of content) {
			if (part.type === 'text') {
				const textPart = part as TextPartExt;
				let currentText = textPart.text;
				if (text !== '') {
					text += '\n'; // Add newline if concatenating multiple text parts
				}
				text += linkCitations(currentText, sources);
			} else if (part.type === 'reasoning') {
				reasoning = part.text;
			} else if (part.type === 'image') {
				const imagePart = part as ImagePartExt;
				const attachment: Attachment = {
					type: 'image',
					filename: imagePart.filename || 'image.png',
					size: imagePart.size || 0,
					mediaType: imagePart.mediaType || 'image/png',
					data: null, // Data is not typically reconstructed from UserContentExt
					previewUrl: undefined,
				};
				if (imagePart.image) {
					attachment.previewUrl = `data:${imagePart.mediaType || 'image/png'};base64,${imagePart.image}`;
				} else if (imagePart.externalURL) {
					attachment.previewUrl = imagePart.externalURL;
				}
				attachments.push(attachment);
			} else if (part.type === 'file') {
				const filePart = part as FilePartExt;
				const attachment: Attachment = {
					type: 'file',
					filename: filePart.filename || 'file',
					size: filePart.size || 0,
					mediaType: filePart.mediaType || 'application/octet-stream',
					data: null, // Data is not typically reconstructed from UserContentExt
					previewUrl: filePart.externalURL,
				};
				attachments.push(attachment);
			}
		}
	}

	return { attachments, text, reasoning };
}


function linkCitations(text: string, sources: LanguageModelV2Source[]): string {
	if (sources?.length > 0) {
		// Replace citations in the text, using a running total for numbering
		sources.forEach((source, index) => {	
			const originalCitationNumber = index + 1;
			// Regex to find the original citation tag, e.g., [1]
			const originalCitationTagRegex = new RegExp(`\\\[${originalCitationNumber}\\\]`, 'g');
			// The new markdown link with the re-numbered citation
			if(source.sourceType === 'url') {
				const newCitationLink = `[[${index + 1}]](${source.url})`;
				console.log('updating citation', originalCitationTagRegex, newCitationLink);
				text = text.replace(originalCitationTagRegex, newCitationLink);
			}
		});
	}
	return text;
}