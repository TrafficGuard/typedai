export interface FileMetadata {
    filename: string;
    description: string;
    /** Size in bytes */
    size: number;
    lastUpdated: string;
}

export const FILE_STORE_NAME = 'FileStore';