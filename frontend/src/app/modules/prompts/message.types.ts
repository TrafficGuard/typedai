export interface Attachment {
	type: 'file' | 'image';
	filename: string;
	size: number;
	data: File | null;
	mediaType: string;
	previewUrl?: string;
}
