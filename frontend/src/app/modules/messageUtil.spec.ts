
import { TestBed } from '@angular/core/testing';
import {
    fileToAttachment,
    attachmentsAndTextToUserContentExt,
    userContentExtToAttachmentsAndText,
} from './messageUtil';
import type { Attachment } from './message.types';
import type { UserContentExt, TextPart, ImagePartExt, FilePartExt } from '#shared/model/llm.model';

// Helper to create a mock File object
const createMockFile = (name: string, type: string, size: number, contentChunks: string[] = ['']): File => {
    const blob = new Blob(contentChunks, { type });
    return new File([blob], name, { type });
};

describe('Message Utilities', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({});
    });

    describe('fileToAttachment', () => {
        it('should convert an image file to an image Attachment with a previewUrl', async () => {
            const mockImageFile = createMockFile('test-image.png', 'image/png', 1024, ['dummyImageData']);
            const attachment = await fileToAttachment(mockImageFile);

            expect(attachment.type).toBe('image');
            expect(attachment.filename).toBe('test-image.png');
            expect(attachment.size).toBe(1024);
            expect(attachment.mimeType).toBe('image/png');
            expect(attachment.data).toBe(mockImageFile);
            expect(attachment.previewUrl).toBeDefined();
            expect(attachment.previewUrl).toContain('data:image/png;base64,');
        });

        it('should convert a non-image file to a file Attachment without a previewUrl (unless it was an image type)', async () => {
            const mockTextFile = createMockFile('test-document.txt', 'text/plain', 512);
            const attachment = await fileToAttachment(mockTextFile);

            expect(attachment.type).toBe('file');
            expect(attachment.filename).toBe('test-document.txt');
            expect(attachment.size).toBe(512);
            expect(attachment.mimeType).toBe('text/plain');
            expect(attachment.data).toBe(mockTextFile);
            expect(attachment.previewUrl).toBeUndefined(); // Or check based on specific logic if non-images can have preview
        });

        it('should handle files with no type as generic file', async () => {
            const mockFileNoType = createMockFile('unknown', '', 123); // Empty string for type
            const attachment = await fileToAttachment(mockFileNoType);
            expect(attachment.type).toBe('file'); // Default to 'file'
            expect(attachment.mimeType).toBe('');
        });
    });

    describe('attachmentsAndTextToUserContentExt', () => {
        it('should convert text only to a string', async () => {
            const result = await attachmentsAndTextToUserContentExt([], 'Hello world');
            expect(result).toBe('Hello world');
        });

        it('should convert attachments only to an array of LlmMessageContentPart', async () => {
            const mockImageFile = createMockFile('img.jpg', 'image/jpeg', 2048, ['imgData']);
            const imageAttachment = await fileToAttachment(mockImageFile);
            const result = await attachmentsAndTextToUserContentExt([imageAttachment], null);

            expect(Array.isArray(result)).toBe(true);
            const parts = result as Array<ImagePartExt | FilePartExt | TextPart>;
            expect(parts.length).toBe(1);
            expect(parts[0].type).toBe('image');
            expect((parts[0] as ImagePartExt).filename).toBe('img.jpg');
            expect((parts[0] as ImagePartExt).mimeType).toBe('image/jpeg');
            expect((parts[0] as ImagePartExt).image).toBeDefined(); // base64 data
        });

        it('should convert mixed text and attachments to an array of LlmMessageContentPart', async () => {
            const mockTextFile = createMockFile('doc.txt', 'text/plain', 100);
            const fileAttachment = await fileToAttachment(mockTextFile);
            const result = await attachmentsAndTextToUserContentExt([fileAttachment], 'Some text');

            expect(Array.isArray(result)).toBe(true);
            const parts = result as Array<ImagePartExt | FilePartExt | TextPart>;
            expect(parts.length).toBe(2);
            expect(parts.find(p => p.type === 'text')).toEqual({ type: 'text', text: 'Some text' });
            expect(parts.find(p => p.type === 'file')?.type).toBe('file');
            expect((parts.find(p => p.type === 'file') as FilePartExt).filename).toBe('doc.txt');
            expect((parts.find(p => p.type === 'file') as FilePartExt).data).toBeDefined(); // base64 data
        });

        it('should return an empty array if no text and no attachments', async () => {
            const result = await attachmentsAndTextToUserContentExt([], null);
            expect(result).toEqual([]);
        });

        it('should correctly convert an attachment with externalURL (non-data URI previewUrl)', async () => {
            const externalUrlAttachment: Attachment = {
                type: 'image',
                filename: 'external.png',
                size: 12345,
                mimeType: 'image/png',
                data: null, // No local file data
                previewUrl: 'https://example.com/image.png'
            };
            const result = await attachmentsAndTextToUserContentExt([externalUrlAttachment], 'Text');
            expect(Array.isArray(result)).toBe(true);
            const parts = result as Array<ImagePartExt | FilePartExt | TextPart>;
            const imagePart = parts.find(p => p.type === 'image') as ImagePartExt;
            expect(imagePart).toBeDefined();
            expect(imagePart.externalURL).toBe('https://example.com/image.png');
            expect(imagePart.image).toBe(''); // No base64 image data since data was null
        });
    });

    describe('userContentExtToAttachmentsAndText', () => {
        it('should convert a string UserContentExt to text and empty attachments', () => {
            const content: UserContentExt = 'Just text';
            const { attachments, text } = userContentExtToAttachmentsAndText(content);
            expect(text).toBe('Just text');
            expect(attachments).toEqual([]);
        });

        it('should convert an array of LlmMessageContentPart to attachments and text', () => {
            const content: UserContentExt = [
                { type: 'text', text: 'Hello ' },
                { type: 'image', image: 'base64imagedata', mimeType: 'image/jpeg', filename: 'photo.jpg', size: 3000 },
                { type: 'text', text: 'world' },
                { type: 'file', data: 'base64filedata', mimeType: 'application/pdf', filename: 'report.pdf', size: 5000 },
            ];
            const { attachments, text } = userContentExtToAttachmentsAndText(content);

            expect(text).toBe('Hello \nworld'); // Note: newline added between text parts
            expect(attachments.length).toBe(2);

            const imageAtt = attachments.find(a => a.type === 'image');
            expect(imageAtt).toBeDefined();
            expect(imageAtt?.filename).toBe('photo.jpg');
            expect(imageAtt?.mimeType).toBe('image/jpeg');
            expect(imageAtt?.previewUrl).toContain('data:image/jpeg;base64,base64imagedata');

            const fileAtt = attachments.find(a => a.type === 'file');
            expect(fileAtt).toBeDefined();
            expect(fileAtt?.filename).toBe('report.pdf');
            expect(fileAtt?.mimeType).toBe('application/pdf');
            // For files, previewUrl is typically from externalURL if present, or undefined
            expect(fileAtt?.previewUrl).toBeUndefined();
        });

        it('should handle UserContentExt with only attachments', () => {
            const content: UserContentExt = [
                { type: 'image', image: '', externalURL: 'http://example.com/img.png', filename: 'remote.png', mimeType: 'image/png', size: 100 }
            ];
            const { attachments, text } = userContentExtToAttachmentsAndText(content);
            expect(text).toBe('');
            expect(attachments.length).toBe(1);
            expect(attachments[0].type).toBe('image');
            expect(attachments[0].filename).toBe('remote.png');
            expect(attachments[0].previewUrl).toBe('http://example.com/img.png');
        });

        it('should handle FilePartExt with externalURL for preview', () => {
            const content: UserContentExt = [
                { type: 'file', data: '', externalURL: 'http://example.com/doc.pdf', filename: 'remote.pdf', mimeType: 'application/pdf', size: 200 }
            ];
            const { attachments, text } = userContentExtToAttachmentsAndText(content);
            expect(text).toBe('');
            expect(attachments.length).toBe(1);
            expect(attachments[0].type).toBe('file');
            expect(attachments[0].filename).toBe('remote.pdf');
            expect(attachments[0].previewUrl).toBe('http://example.com/doc.pdf');
        });
    });
});
