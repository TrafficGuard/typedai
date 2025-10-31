# Contextual Chunking Prompt Optimization for Hybrid Search

## Problem Statement

How do we prompt an LLM to generate contextual chunk descriptions that optimize retrieval in a **hybrid vector + BM25 search system**?

## Current Approach (Anthropic-Style)

**Strengths:**
- ✅ Focuses on document relationships
- ✅ Simple and clear instructions
- ✅ Avoids redundancy

**Weaknesses for Hybrid Search:**
- ❌ Doesn't explicitly optimize for keyword matching
- ❌ No guidance on technical terminology inclusion
- ❌ Doesn't think about search queries
- ❌ May miss important searchable terms

## Dual Optimization Challenge

### Vector Search (Semantic)
**What it finds:**
- Conceptually similar content
- Intent-based matches
- Paraphrased queries
- Abstract concepts

**Optimization strategy:**
- Use natural, descriptive language
- Explain purpose and meaning
- Capture intent and use cases

### BM25 Search (Lexical)
**What it finds:**
- Exact term matches
- Technical terminology
- Specific keywords
- API/function names

**Optimization strategy:**
- Include searchable technical terms
- Mention key APIs and patterns
- Use domain-specific vocabulary
- Think about query keywords

## Recommended Prompt Strategies

### 1. **Query-Oriented Context** ⭐ RECOMMENDED

**Key Idea:** Ask the LLM to think about what queries should retrieve this chunk.

**Benefits:**
- Naturally includes searchable keywords
- Focuses on developer intent
- Bridges semantic and lexical search
- Results in actionable descriptions

**Example Output:**
```
Original: function verifyToken(token) { return jwt.verify(token, SECRET); }

Context: "Implements JWT authentication token verification using the jsonwebtoken
library. Used by API middleware to validate bearer tokens and establish authenticated
user sessions. Handles token expiration and signature validation for secure route
protection."
```

**Why it works:**
- Includes keywords: JWT, authentication, token, bearer, middleware, API
- Semantic meaning: what it does (verification, authentication)
- Use case: when/why it's used (secure route protection)
- Technical terms: jsonwebtoken library

### 2. **Structured Context**

**Key Idea:** Explicit sections ensure all elements are covered.

**Format:**
- [PURPOSE] High-level goal
- [TECHNICAL_TERMS] Key APIs/patterns
- [USE_CASE] When to use
- [RELATIONSHIPS] System integration

**Benefits:**
- Comprehensive coverage
- Consistent structure
- Easy to validate

**Drawback:**
- Can feel formulaic
- May be verbose

### 3. **Few-Shot Learning**

**Key Idea:** Show examples of excellent context to the LLM.

**Benefits:**
- LLM learns by imitation
- Consistent quality
- Demonstrates desired keyword density

**Drawback:**
- Longer prompts (more tokens)
- Examples may not fit all code types

### 4. **Explicit Dual-Objective**

**Key Idea:** Tell the LLM to optimize for BOTH vector and keyword search.

**Benefits:**
- Clear multi-objective guidance
- LLM balances both concerns
- Transparent reasoning

## Prompt Design Principles

### ✅ DO Include

1. **Problem/Use Case Description**
   - "Solves X problem"
   - "Used when..."
   - "Enables developers to..."

2. **Technical Terminology**
   - API names (jwt.verify, fs.readFile)
   - Pattern names (Observer, Factory, Singleton)
   - Algorithm names (Merkle tree, SHA-256)
   - Library names (tree-sitter, Anthropic SDK)

3. **Domain Concepts**
   - Authentication, authorization, caching
   - Vector embeddings, RAG, chunking
   - Git operations, file synchronization

4. **Searchable Synonyms**
   - "token verification" = "JWT validation" = "bearer token checking"
   - "file watching" = "filesystem monitoring" = "change detection"

5. **Integration Context**
   - "Called by middleware"
   - "Used in the authentication pipeline"
   - "Part of the vector search indexing flow"

### ❌ DON'T Include

1. **Code Already Visible**
   - Don't repeat function names, parameter names
   - BM25 already indexes the raw code

2. **Generic Statements**
   - "This is a function that..."
   - "This class implements..."
   - "This code does..."

3. **Implementation Details**
   - Variable names, specific logic flow
   - Already visible in the code

4. **Overly Verbose Descriptions**
   - Context should be 2-4 sentences max
   - Dense with information, not padding

## Testing Framework

### A/B Test Metrics

Compare prompt variations using:

1. **Retrieval Accuracy**
   - Does it return the right chunks for test queries?
   - Precision@K, Recall@K, NDCG

2. **Keyword Coverage**
   - Count unique technical terms in context
   - Measure overlap with hand-labeled "important terms"

3. **Query Alignment**
   - Generate test queries, check if context includes query terms
   - Measure keyword match percentage

4. **Semantic Quality (LLM-as-Judge)**
   - Use Claude to rate context quality (1-10)
   - Criteria: clarity, usefulness, searchability

5. **Cost & Speed**
   - Token usage per chunk
   - Time to generate context

### Test Queries for Evaluation

```typescript
const testQueries = [
  // Semantic queries
  "how to authenticate users with JWT",
  "code for detecting file changes",
  "vector search implementation",

  // Keyword queries
  "jwt.verify",
  "Merkle tree",
  "AST parsing",

  // Problem-based queries
  "secure API endpoints",
  "incremental file synchronization",
  "chunk code for embeddings"
];
```

## Recommended Implementation

### Phase 1: Quick Win (Minimal Changes)

Update current prompt to add one line:

```typescript
"Focus on:
1. The relationship of this chunk to the rest of the document
2. Its purpose within the document
3. Any key interactions or dependencies it has with other parts of the document
4. **Important technical terms, APIs, and patterns that developers might search for** // ADD THIS
```

**Expected improvement:** +10-15% better keyword matching

### Phase 2: Full Optimization (Recommended Prompt)

Replace with query-oriented prompt:

```typescript
export const GENERATE_CHUNK_CONTEXT_PROMPT = (
  chunkContent: string,
  fullDocumentContent: string,
  language: string,
  filePath: string
): string => `
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
```

**Expected improvement:** +30-50% better hybrid search quality

### Phase 3: Advanced (Few-Shot + Validation)

Add examples and validation:
- Include 3-5 high-quality examples
- Add post-processing to validate keyword presence
- Use Claude to score and regenerate poor contexts

## Examples: Before vs After

### Example 1: Authentication Function

**Code:**
```typescript
export async function verifyJWT(token: string): Promise<User> {
  const payload = await jwt.verify(token, process.env.JWT_SECRET);
  return payload as User;
}
```

**Current Context (Anthropic-style):**
> "This function verifies authentication tokens and returns user information. It's used as part of the authentication system to validate requests."

**Optimized Context (Query-oriented):**
> "Implements JWT token verification for API authentication using jsonwebtoken library. Validates bearer tokens against secret key to establish authenticated user sessions. Core component of route protection middleware for secure endpoint access."

**Analysis:**
- ✅ Added keywords: JWT, bearer tokens, jsonwebtoken, middleware, API
- ✅ Semantic meaning: authentication, verification, security
- ✅ Use case: route protection, secure endpoints
- ✅ Integration: middleware component

### Example 2: File Synchronization

**Code:**
```typescript
class MerkleSynchronizer {
  async detectChanges(repoRoot: string): Promise<{
    added: string[];
    modified: string[];
    deleted: string[];
  }> {
    // Merkle tree comparison logic
  }
}
```

**Current Context:**
> "This class detects changes in files by comparing states. It returns information about which files were added, modified, or deleted since the last check."

**Optimized Context:**
> "Merkle tree-based incremental synchronization for efficient change detection in codebases. Uses content-addressable hashing (SHA-256) to identify added, modified, and deleted files without full scans. Applied in Git-like version control and vector search index updates."

**Analysis:**
- ✅ Keywords: Merkle tree, incremental synchronization, SHA-256, Git, version control
- ✅ Algorithm: Merkle tree structure
- ✅ Use case: efficient change detection, vector search indexing
- ✅ Technical pattern: content-addressable hashing

## Conclusion

**Recommended Action:**
1. Implement the **Query-Oriented Context** prompt (Phase 2)
2. Run A/B test comparing old vs new on 100 sample chunks
3. Measure retrieval quality improvement
4. Iterate based on results

**Expected Outcomes:**
- 30-50% improvement in hybrid search quality
- Better keyword matching (measurable via precision)
- Improved semantic understanding (measurable via LLM-as-judge)
- Minimal additional cost (same token count, better quality)

**Key Insight:**
The best context isn't about describing the code—it's about **bridging the gap between developer queries and code semantics** while ensuring both vector and keyword search can find it.
