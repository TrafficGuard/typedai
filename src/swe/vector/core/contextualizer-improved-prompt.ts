/**
 * IMPROVED CONTEXTUAL CHUNKING PROMPT
 * Optimized for hybrid vector + BM25 search
 *
 * Design Principles:
 * 1. Query-oriented: Think about how developers search
 * 2. Keyword-rich: Include searchable technical terms
 * 3. Semantic-clear: Explain meaning and purpose
 * 4. Domain-aware: Use proper terminology
 * 5. Non-redundant: Don't repeat obvious code content
 */

export const HYBRID_OPTIMIZED_CONTEXT_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
You are an expert code search assistant helping to improve retrieval of code chunks.

<document lang="${language}">
${fullDocumentContent}
</document>

<chunk_to_contextualize>
${chunkContent}
</chunk_to_contextualize>

Generate a concise context (2-4 sentences) for this code chunk that will improve search retrieval in a hybrid vector + keyword search system.

Your context should optimize for BOTH:
1. **Semantic search** (vector embeddings) - natural language meaning
2. **Keyword search** (BM25) - exact term matching

Guidelines:

**INCLUDE:**
- **Problem/Use Case**: What problem does this solve? When would a developer use this?
- **Key Technical Terms**: Important APIs, patterns, algorithms, or domain concepts (helps BM25)
- **Semantic Purpose**: What it does at a conceptual level (helps vector search)
- **Searchable Synonyms**: Alternative terms developers might search for
- **Integration Points**: How it connects to other systems/modules

**AVOID:**
- Repeating exact code that's already in the chunk (already indexed by BM25)
- Generic descriptions like "this is a function" or "this is a class"
- Implementation details already visible in the code
- Overly verbose explanations

**THINK ABOUT:**
- How would a developer search for this code? What queries would they use?
- What information is NOT obvious from reading the code alone?
- What domain knowledge or context is needed to understand this?

**FORMAT:**
Write 2-4 sentences of natural, query-oriented context. Use specific technical terminology and mention key concepts.

Context:`;

/**
 * ALTERNATIVE: Query-First Approach
 * Explicitly asks LLM to think about search queries first
 */
export const QUERY_FIRST_CONTEXT_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>

<chunk>
${chunkContent}
</chunk>

**Task**: Generate optimal search context for this code chunk in a hybrid vector + keyword search system.

**Step 1 - Think about queries** (don't output this):
What search queries should retrieve this chunk? Consider:
- Natural language: "how to...", "code that...", "function for..."
- Technical terms: API names, patterns, algorithms
- Problem-based: "solve X", "handle Y", "implement Z"

**Step 2 - Generate context** (output this):
Write 2-4 sentences that:
1. Describe what this code accomplishes (in query-like language)
2. Mention key technical terms and APIs
3. Explain the use case or problem it solves
4. Reference important patterns or algorithms used

Include specific searchable keywords that developers would use to find this code.

Context:`;

/**
 * ALTERNATIVE: Structured Context with Explicit Sections
 * Better for ensuring all elements are covered
 */
export const STRUCTURED_CONTEXT_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>

<chunk>
${chunkContent}
</chunk>

Generate a structured context for this code chunk to optimize hybrid search (vector + keyword).

Output format (as a single flowing paragraph):

[PURPOSE] What this code does at a high level
[TECHNICAL_TERMS] Key APIs, patterns, or algorithms: {list important searchable terms}
[USE_CASE] When/why a developer would need this
[RELATIONSHIPS] How it connects to other parts of the system

Keep it concise (2-4 sentences total). Focus on information NOT obvious from the code itself.

Context:`;

/**
 * ALTERNATIVE: Few-Shot Learning with Examples
 * Show the LLM what good context looks like
 */
export const FEW_SHOT_CONTEXT_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
Generate search-optimized context for code chunks. Here are examples:

**Example 1:**
Code: function authenticateUser(token) { return jwt.verify(token, SECRET); }
Context: Implements JWT-based authentication using the jsonwebtoken library. Verifies bearer tokens for API security and user session management. Used by middleware to protect authenticated routes.

**Example 2:**
Code: class MerkleDAG { addNode(data, parent) { ... } }
Context: Merkle Directed Acyclic Graph implementation for content-addressable storage and change detection. Uses SHA-256 hashing for node identification. Applied in version control systems, blockchain, and incremental synchronization algorithms.

**Example 3:**
Code: async function chunkDocument(text, chunkSize) { ... }
Context: Text chunking utility for semantic search and vector embeddings. Implements sliding window with overlap to maintain context boundaries. Optimized for RAG (Retrieval-Augmented Generation) pipelines and document indexing workflows.

---

Now generate context for this chunk:

<document lang="${language}">
${fullDocumentContent}
</document>

<chunk>
${chunkContent}
</chunk>

Context (2-4 sentences, keyword-rich, query-oriented):`;

/**
 * COMPARISON: Current Anthropic-Style Prompt (for reference)
 */
export const CURRENT_ANTHROPIC_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>

Here is the chunk we want to situate within the whole document. It is also in ${language}.
<chunk>
${chunkContent}
</chunk>

Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.

Focus on:
1. The relationship of this chunk to the rest of the document
2. Its purpose within the document
3. Any key interactions or dependencies it has with other parts of the document

Answer only with the succinct context and nothing else.
`;

/**
 * RECOMMENDED: Hybrid-Optimized with Code-Specific Enhancements
 */
export const RECOMMENDED_HYBRID_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string, filePath: string): string => `
Generate search-optimized context for this ${language} code chunk.

<document path="${filePath}">
${fullDocumentContent}
</document>

<chunk>
${chunkContent}
</chunk>

Write 2-4 sentences that help developers find this code through:
- **Semantic search**: Describe what it does and why it exists
- **Keyword search**: Include specific technical terms, APIs, patterns, and domain concepts

Focus on:
1. **What problem this solves** - the use case or scenario
2. **Key technical terms** - APIs, algorithms, patterns, libraries used
3. **Domain context** - how it fits in the broader system
4. **Searchable concepts** - terms developers would query for

Avoid repeating code that's already visible. Think: "If a developer searches for X, should they find this chunk?"

Context:`;
