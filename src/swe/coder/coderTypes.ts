export interface EditBlock {
	filePath: string; // Relative to rootPath
	originalText: string;
	updatedText: string;
}

export type FileEditBlocks = Map<string, EditBlock[]>;

export type EditFormat = 'diff' | 'diff-fenced'; // more to add
