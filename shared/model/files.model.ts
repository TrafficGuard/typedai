export interface FileMetadata {
    filename: string;
    description: string;
    /** Size in bytes */
    size: number;
    lastUpdated: string;
}


export interface SelectedFile {
    /** The file path */
    filePath: string;
    /** The reason why this file needs to in the file selection */
    reason?: string;
    /** If the file should not need to be modified when implementing the task. Only relevant when the task is for making changes, and not just a query. */
    readOnly?: boolean;
    category?: 'edit' | 'reference' | 'style_example' | 'unknown';
}

export const FILE_STORE_NAME = 'FileStore';