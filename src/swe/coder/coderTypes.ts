export interface EditBlock {
	filePath: string; // Relative to rootPath
	originalText: string;
	updatedText: string;
}

export type FileEditBlocks = Map<string, EditBlock[]>;

/*  Extend the union so every value in MODEL_EDIT_FORMATS is representable.
    Parsing logic is only implemented for 'diff' and 'diff-fenced' for now;
    the others will fall back to the 'diff' parser (handled in dispatcher). */
export type EditFormat = 'diff' | 'diff-fenced' | 'whole' | 'architect';
