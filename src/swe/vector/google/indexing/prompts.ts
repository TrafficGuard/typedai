export const TRANSLATE_CODE_TO_NL_PROMPT = (language: string, codeChunkText: string): string => `
You are an expert software engineer. Your task is to provide a clear, detailed, and semantically rich natural language explanation of the following ${language} code snippet.

Code Snippet:
\`\`\`${language}
${codeChunkText}
\`\`\`

Please provide an explanation covering:
1.  **Overall Purpose:** What is the primary goal of this code?
2.  **Key Functionalities:** What are the main operations or tasks it performs?
3.  **Mechanism:** Briefly, how does it achieve these functionalities?
4.  **Inputs & Outputs:** What are the main inputs it expects and outputs it produces (including types if obvious)?
5.  **Side Effects:** Are there any significant side effects (e.g., modifying external state, I/O operations)?
6.  **Context (if applicable):** If this snippet seems to be part of a larger module or system, what might its role be?

Your explanation should be in plain natural language, suitable for creating a high-quality embedding for semantic search. Be comprehensive yet as concise as possible while capturing the essential meaning and behavior of the code.
Explanation:`;

export const GENERATE_CHUNK_CONTEXT_PROMPT = (chunkContent: string, fullDocumentContent: string, language: string): string => `
<document lang="${language}">
${fullDocumentContent}
</document>
Here is the chunk we want to situate within the whole document. It is also in ${language}.
<chunk>
${chunkContent}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.
Focus on the relationship of this chunk to the rest of the document, its purpose within the document, and any key interactions or dependencies it has with other parts of the document.
Answer only with the succinct context and nothing else.
`;
