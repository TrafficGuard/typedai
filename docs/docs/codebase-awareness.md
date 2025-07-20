# Codebase Awareness

The AI platform provides powerful codebase awareness features to its coding agents, enabling them to understand and navigate complex repositories effectively. This is achieved through a sophisticated indexing process that combines LLM-generated summaries with vector-based semantic search.

## Overview

When an agent works on a task within a git repository, it can leverage a pre-built index of the codebase. This index provides two key capabilities:

1.  **Hierarchical Summaries**: The agent has access to summaries of files and directories, providing a high-level understanding of the project's structure and purpose.
2.  **Semantic Search**: The agent can perform natural language queries to find relevant code snippets, functions, or classes across the entire repository.

These capabilities allow the agent to quickly locate relevant code, understand its context, and make more informed decisions when implementing changes.

## Indexing Process

The codebase awareness is built by running an indexing process. This can be triggered from the command line:

```bash
npm run index
```

This command initiates two main tasks: generating summaries and creating a vector index.

### LLM-Generated Summaries

The platform walks through the repository's file structure and uses a Large Language Model (LLM) to generate descriptive summaries for individual files and entire directories.

-   **Bottom-Up Approach**: Summaries are generated from the bottom up. File summaries are created first, which are then used to generate summaries for their parent directories, continuing all the way to the project root.
-   **Configuration**: The specific files and directories to be summarized are controlled by glob patterns defined in the `indexDocs` array within the project's `ai.info.json` file.
-   **Caching**: The process is intelligent and efficient. It uses content hashes to track changes, ensuring that summaries are only regenerated for files or directories that have been modified.
-   **Storage**: The generated summaries are stored in a `.typedai/docs/` directory within the project, creating a parallel structure that maps to the source code.

These summaries are used to create various "repository maps" that can be fed to the agent as context, such as a file tree annotated with short descriptions.

### Vector-Based Semantic Search

To enable powerful semantic search, the platform indexes the codebase into a vector store.

-   **Technology**: This feature leverages Google Cloud's Vertex AI Search (formerly Discovery Engine) and Vertex AI embedding models (e.g., `gemini-embedding-001`).
-   **Chunking and Embedding**: Code files are broken down into smaller, meaningful chunks (e.g., functions or classes). Each chunk is then converted into a numerical representation (a vector embedding) that captures its semantic meaning.
-   **Contextualization**: Before embedding, chunks are "contextualized" by including surrounding code. This helps the model create more accurate and context-aware embeddings.
-   **Storage and Retrieval**: The embeddings are stored in a dedicated data store within Google's Discovery Engine. The data store is uniquely identified based on the repository's git origin URL. When an agent performs a search, its query is also converted into an embedding, and the system finds the code chunks with the most similar embeddings.

This allows an agent to ask questions like "where is the code for user authentication?" and receive the most relevant code snippets from the repository.

## Configuration

-   **`ai.info.json`**: This file at the root of the repository is crucial for configuring which parts of the codebase are indexed. The `indexDocs` property should contain an array of `micromatch` glob patterns.
-   **Google Cloud**: The vector search functionality requires a configured Google Cloud project. The necessary credentials and configuration (like `GCLOUD_PROJECT`) must be available as environment variables.
