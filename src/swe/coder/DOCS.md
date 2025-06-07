## SEARCH/REPLACE Edit Formats

These formats instruct the Language Model (LLM) to provide code modifications using a specific block structure. The TypeScript implementation will need to parse these blocks from the LLM's text response.

**Common Parsing Markers:**
The LLM is instructed to use the following markers to define the edit blocks. The sequences of `<`, `=`, and `>` characters can vary in length (typically 5 to 9 characters). A robust parser should accommodate this variability.

*   **Search Block Start:** e.g., `<<<<<<< SEARCH`
*   **Divider:** e.g., `=======`
*   **Replace Block End / Next Divider:** e.g., `>>>>>>> REPLACE`

**Fence Configuration:**
A configurable fence string (e.g., ` ``` ` for the opening fence and ` ``` ` for the closing fence) is used. The LLM is instructed to wrap code sections, including the SEARCH/REPLACE blocks, within these fences, often with a language identifier (e.g., ` ```typescript`).

**Filename Identification:**
The parser needs to identify the target file for each edit block. The method for this varies slightly between formats, primarily concerning whether the filename is inside or outside the main code fence. The parser should look for the filename on a line preceding the `<<<<<<< SEARCH` marker (for `diff` format) or immediately after the opening fence (for `diff-fenced` format). This process should involve robust stripping of common markdown (like asterisks `*`, backticks ` `` `), comment prefixes (like `#`), and trailing colons from the potential filename line.

**New File Creation:**
If an `EditBlock` is parsed where `originalText` is empty or consists only of whitespace, this typically signifies that the `updatedText` should be used to create a new file at the specified `filePath`.

---

### 1. Edit Format: `diff`

*   **EditFormat Value (TypeScript):** `'diff'`
*   **Expected LLM Response Structure for Edits:**
    ```text
    path/to/filename.ext
    <FENCE_OPEN>language
    <<<<<<< SEARCH
    // Content to be replaced
    // ...
    =======
    // New content
    // ...
    >>>>>>> REPLACE
    <FENCE_CLOSE>
    ```
    *   The `path/to/filename.ext` appears on its own line, *preceding* the fenced code block.
    *   `<FENCE_OPEN>` and `<FENCE_CLOSE>` are the configured fence strings (e.g., ` ``` `).
*   **Key Prompting Strategies for LLM:**
    *   Instruct the LLM to first state the full, verbatim file path on a line by itself.
    *   Then, instruct it to use an opening fence with the appropriate language tag.
    *   Clearly define the `<<<<<<< SEARCH`, `=======`, and `>>>>>>> REPLACE` marker usage (including potential length variations) for delineating the original and updated code sections.
    *   Specify that the block should end with a closing fence.
    *   Encourage the LLM to suggest relevant shell commands in separate, appropriately tagged fenced blocks (e.g., ` ```bash`).
*   **Parsing Logic Highlights (TypeScript):**
    *   Identify the filename by looking at the line(s) immediately preceding a line that starts with `<FENCE_OPEN>` or immediately preceding the `<<<<<<< SEARCH` marker if no fence is present right before the marker. Apply robust stripping to this filename line.
    *   Once inside a fenced block, look for the `<<<<<<< SEARCH` marker.
    *   Accumulate lines into `originalText` until `=======` is found.
    *   Accumulate lines into `updatedText` until `>>>>>>> REPLACE` is found.
    *   *Robustness:* The parser attempts to find blocks even if the outer fence is missing, relying on the filename preceding the `<<<<<<< SEARCH` marker.

*   **Notes:**
    *   This is a foundational SEARCH/REPLACE format.
    *   The separation of filename and the fenced edit block is a key characteristic.

---

### 2. Edit Format: `diff-fenced`

*   **EditFormat Value (TypeScript):** `'diff-fenced'`
*   **Expected LLM Response Structure for Edits:**
    ```text
    <FENCE_OPEN>language
    path/to/filename.ext
    <<<<<<< SEARCH
    // Content to be replaced
    // ...
    =======
    // New content
    // ...
    >>>>>>> REPLACE
    <FENCE_CLOSE>
    ```
    *   The `path/to/filename.ext` appears on its own line, *inside* the main fenced code block, typically immediately after the opening fence and language tag.
*   **Key Prompting Strategies for LLM:**
    *   Instruct the LLM to use an opening fence with the appropriate language tag.
    *   Then, instruct it to state the full, verbatim file path on a line by itself *within this fenced block*.
    *   Clearly define the `<<<<<<< SEARCH`, `=======`, and `>>>>>>> REPLACE` marker usage (including potential length variations).
    *   Specify that the block should end with a closing fence.
    *   Encourage the LLM to suggest relevant shell commands.
*   **Parsing Logic Highlights (TypeScript):**
    *   After encountering `<FENCE_OPEN>language`, expect the next non-blank line to be the filename. Apply robust stripping to this filename line.
    *   Following the filename, look for the `<<<<<<< SEARCH` marker.
    *   Accumulation of `originalText` and `updatedText` is the same as for the `diff` format.
*   **Shell Command Handling:**
    *   Same as the `diff` format: LLM is prompted, and the parser should handle them separately.
*   **Notes:**
    *   The primary distinction from `diff` is the filename's placement *inside* the main code fence.

---

### 3. Edit Format: `editor-diff` (Prompting Variant of `diff`)

*   **EditFormat Value (TypeScript):** This could map to `'diff'` in the `EditFormat` type, with the distinction handled by the prompting system rather than a separate parser.
*   **Expected LLM Response Structure for Edits:**
    Identical to the `diff` format:
    ```text
    path/to/filename.ext
    <FENCE_OPEN>language
    <<<<<<< SEARCH
    // Content to be replaced
    =======
    // New content
    >>>>>>> REPLACE
    <FENCE_CLOSE>
    ```
*   **Key Prompting Strategies for LLM:**
    *   The prompting for the SEARCH/REPLACE block structure itself is the same as for `diff`.
    *   **Crucially, prompts encouraging the LLM to suggest shell commands are omitted or explicitly disabled.** The LLM is guided to focus solely on providing code edits.
*   **Parsing Logic Highlights (TypeScript):**
    *   Identical to the `diff` format for parsing the edit blocks.
*   **Shell Command Handling:**
    *   Shell commands are not actively solicited from the LLM.
    *   The parser might still be capable of identifying them if the LLM produces them, but they are not an expected part of the output for this "editor" variant.
*   **Notes:**
    *   This format uses the `diff` structure but aims for a cleaner LLM response by minimizing non-edit content. The TypeScript implementation would achieve this by selecting a different set of system prompts/reminders when this "mode" is active.

---

### 4. Edit Format: `editor-diff-fenced` (Prompting Variant of `diff-fenced`)

*   **EditFormat Value (TypeScript):** This could map to `'diff-fenced'` in the `EditFormat` type, with the distinction handled by the prompting system.
*   **Expected LLM Response Structure for Edits:**
    Identical to the `diff-fenced` format:
    ```text
    <FENCE_OPEN>language
    path/to/filename.ext
    <<<<<<< SEARCH
    // Content to be replaced
    =======
    // New content
    >>>>>>> REPLACE
    <FENCE_CLOSE>
    ```
*   **Key Prompting Strategies for LLM:**
    *   The prompting for the SEARCH/REPLACE block structure itself is the same as for `diff-fenced`.
    *   **Prompts encouraging shell command suggestions are omitted or explicitly disabled.**
*   **Parsing Logic Highlights (TypeScript):**
    *   Identical to the `diff-fenced` format for parsing the edit blocks.
*   **Shell Command Handling:**
    *   Shell commands are not actively solicited.
*   **Notes:**
    *   This format uses the `diff-fenced` structure with a prompting strategy focused purely on edits.

---

**General TypeScript Parser Design Considerations:**

1.  **State Management:** Implement a state machine or similar logic to track the current parsing context (e.g., `EXPECTING_FILENAME_OUTSIDE_FENCE`, `EXPECTING_FILENAME_INSIDE_FENCE`, `IN_SEARCH_BLOCK`, `IN_REPLACE_BLOCK`, `IN_SHELL_COMMAND`).
2.  **Filename Extraction Function:**
    *   This function should handle stripping common markdown (e.g., `*`, ` `` `, surrounding quotes), comment prefixes (e.g., `#`), and trailing punctuation (e.g., `:`) from potential filename lines.
    *   It needs to be aware of whether to look for the filename before an opening fence or immediately after it, based on the active `EditFormat` (or the active prompting strategy).
3.  **Configurable Markers & Fences:** Store the SEARCH/REPLACE markers (potentially as regular expressions to handle variable lengths) and fence strings in configurable variables.
4.  **Robustness:** Handle cases like empty search/replace blocks, missing markers, files with multiple edit blocks, and variations in whitespace. Implement fallback parsing strategies if a primary strategy fails but markers are detected.
5.  **Output:** The parser should populate a `FileEditBlocks` map (or a similar structure, e.g., an array of objects each containing `filePath` and an array of `EditBlock`s) where keys are file paths and values are arrays of `EditBlock` objects for that file.
