import type { Attachment } from './message.types';
import type {
    TextPart,
    ImagePartExt,
    FilePartExt,
    UserContentExt
} from '#shared/llm/llm.model';

// LlmMessageContentPart is a union of the imported part types
export type LlmMessageContentPart = TextPart | ImagePartExt | FilePartExt;

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
                image: '', // Initialize required field
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.size,
                externalURL: undefined, // Initialize optional field
            };
            if (attachment.previewUrl && attachment.previewUrl.startsWith('data:')) {
                const base64Data = attachment.previewUrl.split(',')[1];
                if (base64Data) {
                    imagePart.image = base64Data;
                }
                // If base64Data is null/undefined, image remains ""
            } else if (attachment.previewUrl) {
                // If previewUrl is not a data URI, assume it's an external URL
                imagePart.externalURL = attachment.previewUrl;
                // image remains "" as we don't have base64 data for the 'image' field itself
            }
            // If no previewUrl, image remains ""
            parts.push(imagePart);
        } else if (attachment.type === 'file') {
            const filePart: FilePartExt = {
                type: 'file',
                data: '', // Initialize required field (functionally problematic, but type-correct)
                mimeType: attachment.mimeType || 'application/octet-stream', // Ensure required field is set
                filename: attachment.filename,
                size: attachment.size,
                externalURL: undefined, // Initialize optional field
            };
            // If previewUrl for files represents an external link, assign it
            if (attachment.previewUrl && !attachment.previewUrl.startsWith('data:')) {
                filePart.externalURL = attachment.previewUrl;
            }
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
                const imagePart = part as ImagePartExt; // Now using shared ImagePartExt
                const attachment: Attachment = {
                    type: 'image',
                    filename: imagePart.filename || 'image.png', // filename is optional in AttachmentInfo
                    size: imagePart.size || 0, // size is optional in AttachmentInfo
                    mimeType: imagePart.mimeType || 'image/png', // mimeType is optional in base ImagePart
                    data: null,
                    previewUrl: undefined,
                };
                // imagePart.image is a required string (base64 data)
                // Prioritize imagePart.image for previewUrl if available
                if (imagePart.image && imagePart.image.length > 0) { // Check if not an empty string
                    attachment.previewUrl = `data:${imagePart.mimeType || 'image/png'};base64,${imagePart.image}`;
                } else if (imagePart.externalURL) {
                    attachment.previewUrl = imagePart.externalURL;
                }
                attachments.push(attachment);
            } else if (part.type === 'file') {
                const filePart = part as FilePartExt; // Now using shared FilePartExt
                const attachment: Attachment = {
                    type: 'file',
                    filename: filePart.filename || 'file', // filename is optional in AttachmentInfo
                    size: filePart.size || 0, // size is optional in AttachmentInfo
                    mimeType: filePart.mimeType, // mimeType is required in shared FilePartExt
                    data: null,
                    previewUrl: filePart.externalURL, // externalURL is optional in AttachmentInfo
                };
                // filePart.data (base64 string) is required but not used to reconstruct Attachment.data (File object)
                attachments.push(attachment);
            }
        }
    }

    return { attachments, text };
}
