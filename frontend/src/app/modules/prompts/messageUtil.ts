import type { Attachment } from './message.types';

// Type definitions (as provided, assuming #shared/model/llm.model is not directly importable here)
export interface TextPart {
    type: 'text';
    text: string;
}

export interface ImagePart { // Base, might be extended by ImagePartExt
    type: 'image';
    // Common properties for an image
}

export interface ImagePartExt extends ImagePart {
    image?: string; // Base64 encoded image data
    mimeType?: string;
    filename?: string;
    size?: number;
    externalURL?: string; // URL to an externally hosted image
    // Potentially other 'ext' (extended) properties
}

export interface FilePart { // Base, might be extended by FilePartExt
    type: 'file';
    // Common properties for a file
}

export interface FilePartExt extends FilePart {
    mimeType?: string;
    filename?: string;
    size?: number;
    externalURL?: string; // URL to an externally hosted file
    // Potentially other 'ext' (extended) properties
}

export type LlmMessageContentPart = TextPart | ImagePartExt | FilePartExt;

export type UserContentExt = string | LlmMessageContentPart[];

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
export function attachmentsAndTextToUserContentExt(attachments: Attachment[], text: string | null | undefined): UserContentExt {
    const parts: LlmMessageContentPart[] = [];

    if (text && text.trim() !== '') {
        parts.push({ type: 'text', text: text.trim() });
    }

    for (const attachment of attachments) {
        if (attachment.type === 'image') {
            const imagePart: ImagePartExt = {
                type: 'image',
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.size,
            };
            if (attachment.previewUrl && attachment.previewUrl.startsWith('data:')) {
                // Assuming previewUrl is a base64 data URI
                const base64Data = attachment.previewUrl.split(',')[1];
                if (base64Data) {
                    imagePart.image = base64Data;
                }
            }
            parts.push(imagePart);
        } else if (attachment.type === 'file') {
            const filePart: FilePartExt = {
                type: 'file',
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.size,
            };
            parts.push(filePart);
        }
    }

    if (parts.length === 0) {
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
