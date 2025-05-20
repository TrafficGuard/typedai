import type { Attachment } from 'app/modules/message.types';
import type {
    UserContentExt,
    TextPart,
    ImagePartExt,
    FilePartExt,
} from '#shared/model/llm.model';

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
		reader.onerror = error => reject(error);
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
        mimeType: file.type,
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
    } else {
        return Promise.resolve(attachment);
    }
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
                mimeType: attachment.mimeType, // Optional in shared ImagePart, but good to provide
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
                mimeType: attachment.mimeType, // Required
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
 * @returns An object containing an array of Attachments and a text string.
 */
export function userContentExtToAttachmentsAndText(content: UserContentExt | undefined): { attachments: Attachment[], text: string } {
    let text = '';
    const attachments: Attachment[] = [];

    if (!content) {
        return { attachments, text };
    }

    if (typeof content === 'string') {
        text = content;
        return { attachments, text };
    }

    if (Array.isArray(content)) {
        for (const part of content) {
            if (part.type === 'text') {
                if (text !== '') {
                    text += '\n'; // Add newline if concatenating multiple text parts
                }
                text += (part as TextPart).text;
            } else if (part.type === 'image') {
                const imagePart = part as ImagePartExt;
                const attachment: Attachment = {
                    type: 'image',
                    filename: imagePart.filename || 'image.png',
                    size: imagePart.size || 0,
                    mimeType: imagePart.mimeType || 'image/png',
                    data: null, // Data is not typically reconstructed from UserContentExt
                    previewUrl: undefined,
                };
                if (imagePart.image) {
                    attachment.previewUrl = `data:${imagePart.mimeType || 'image/png'};base64,${imagePart.image}`;
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
                    mimeType: filePart.mimeType || 'application/octet-stream',
                    data: null, // Data is not typically reconstructed from UserContentExt
                    previewUrl: filePart.externalURL,
                };
                attachments.push(attachment);
            }
        }
    }

    return { attachments, text };
}
