export interface Attachment {
	type: 'file' | 'image';
	filename: string;
	size: number;
	data: File | null;
	mimeType: string;
	previewUrl?: string;
}
