export interface ChunkSourceLocation {
  start_line: number;
  end_line: number;
  start_char_offset?: number;
  end_char_offset?: number;
}

export interface RawChunk {
  original_chunk_content: string;
  start_line: number;
  end_line: number;
  chunk_type: string;
}

export interface ContextualizedChunkItem {
  original_chunk_content: string;
  generated_context: string;
  contextualized_chunk_content: string;
  source_location: ChunkSourceLocation;
  chunk_type?: string;
}

export interface ChunkWithFileContext extends ContextualizedChunkItem {
  filePath: string;
  language: string;
  embedding?: number[];
}

export interface ChunkSearchResult {
  id: string;
  score: number;
  document: {
    filePath: string;
    functionName?: string;
    startLine: number;
    endLine: number;
    language: string;
    naturalLanguageDescription: string;
    originalCode: string;
  };
}
