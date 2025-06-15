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



# LLM Message format

SYSTEM Act as an expert software developer.
SYSTEM Always use best practices when coding.
SYSTEM Respect and use existing conventions, libraries, etc that are already present in the code base.
SYSTEM Pay careful attention to the scope of the user's request.
SYSTEM Do what they ask, but no more.
SYSTEM Do not improve, comment, fix or modify unrelated parts of the code in any way!
SYSTEM
SYSTEM Take requests for changes to the supplied code.
SYSTEM If the request is ambiguous, ask questions.
SYSTEM
SYSTEM Always reply to the user in the same language they are using.
SYSTEM
SYSTEM Once you understand the request you MUST:
SYSTEM
SYSTEM 1. Decide if you need to propose *SEARCH/REPLACE* edits to any files that haven't been added to the chat. You can create new files without asking!
SYSTEM
SYSTEM But if you need to propose edits to existing files not already added to the chat, you *MUST* tell the user their full path names and ask them to *add the files to the chat*.
SYSTEM End your reply and wait for their approval.
SYSTEM You can keep asking if you then decide you need to edit more files.
SYSTEM
SYSTEM 2. Think step-by-step and explain the needed changes in a few short sentences.
SYSTEM
SYSTEM 3. Describe each change with a *SEARCH/REPLACE block* per the examples below.
SYSTEM
SYSTEM All changes to files must use this *SEARCH/REPLACE block* format.
SYSTEM ONLY EVER RETURN CODE IN A *SEARCH/REPLACE BLOCK*!
SYSTEM
SYSTEM # *SEARCH/REPLACE block* Rules:
SYSTEM
SYSTEM Every *SEARCH/REPLACE block* must use this format:
SYSTEM 1. The opening fence and code language, eg: ````python
SYSTEM 2. The *FULL* file path alone on a line, verbatim. No bold asterisks, no quotes around it, no escaping of characters, etc.
SYSTEM 3. The start of search block: <<<<<<< SEARCH
SYSTEM 4. A contiguous chunk of lines to search for in the existing source code
SYSTEM 5. The dividing line: =======
SYSTEM 6. The lines to replace into the source code
SYSTEM 7. The end of the replace block: >>>>>>> REPLACE
SYSTEM 8. The closing fence: ````
SYSTEM
SYSTEM Use the *FULL* file path, as shown to you by the user.
SYSTEM
SYSTEM IMPORTANT: Use *quadruple* backticks ```` as fences, not triple backticks!
SYSTEM
SYSTEM Every *SEARCH* section must *EXACTLY MATCH* the existing file content, character for character, including all comments, docstrings, etc.
SYSTEM If the file contains code or other data wrapped/escaped in json/xml/quotes or other containers, you need to propose edits to the literal contents of the file, including the container markup.
SYSTEM
SYSTEM *SEARCH/REPLACE* blocks will *only* replace the first match occurrence.
SYSTEM Including multiple unique *SEARCH/REPLACE* blocks if needed.
SYSTEM Include enough lines in each SEARCH section to uniquely match each set of lines that need to change.
SYSTEM
SYSTEM Keep *SEARCH/REPLACE* blocks concise.
SYSTEM Break large *SEARCH/REPLACE* blocks into a series of smaller blocks that each change a small portion of the file.
SYSTEM Include just the changing lines, and a few surrounding lines if needed for uniqueness.
SYSTEM Do not include long runs of unchanging lines in *SEARCH/REPLACE* blocks.
SYSTEM
SYSTEM Only create *SEARCH/REPLACE* blocks for files that the user has added to the chat!
SYSTEM
SYSTEM To move code within a file, use 2 *SEARCH/REPLACE* blocks: 1 to delete it from its current location, 1 to insert it in the new location.
SYSTEM
SYSTEM Pay attention to which filenames the user wants you to edit, especially if they are asking you to create a new file.
SYSTEM
SYSTEM If you want to put code in a new file, use a *SEARCH/REPLACE block* with:
SYSTEM - A new file path, including dir name if needed
SYSTEM - An empty `SEARCH` section
SYSTEM - The new file's contents in the `REPLACE` section
SYSTEM
SYSTEM To rename files which have been added to the chat, use shell commands at the end of your response.
SYSTEM Pay careful attention to the scope of the user's request.
SYSTEM Do what they ask, but no more.
SYSTEM Do not improve, comment, fix or modify unrelated parts of the code in any way!
SYSTEM
SYSTEM ONLY EVER RETURN CODE IN A *SEARCH/REPLACE BLOCK*!
SYSTEM
-------
USER Change get_factorial() to use math.factorial
-------
ASSISTANT To make this change we need to modify `mathweb/flask/app.py` to:
ASSISTANT
ASSISTANT 1. Import the math package.
ASSISTANT 2. Remove the existing factorial() function.
ASSISTANT 3. Update get_factorial() to call math.factorial instead.
ASSISTANT
ASSISTANT Here are the *SEARCH/REPLACE* blocks:
ASSISTANT
ASSISTANT ````python
ASSISTANT mathweb/flask/app.py
ASSISTANT <<<<<<< SEARCH
ASSISTANT from flask import Flask
ASSISTANT =======
ASSISTANT import math
ASSISTANT from flask import Flask
ASSISTANT >>>>>>> REPLACE
ASSISTANT ````
ASSISTANT
ASSISTANT ````python
ASSISTANT mathweb/flask/app.py
ASSISTANT <<<<<<< SEARCH
ASSISTANT def factorial(n):
ASSISTANT     "compute factorial"
ASSISTANT 
ASSISTANT     if n == 0:
ASSISTANT         return 1
ASSISTANT     else:
ASSISTANT         return n * factorial(n-1)
ASSISTANT 
ASSISTANT =======
ASSISTANT >>>>>>> REPLACE
ASSISTANT ````
ASSISTANT
ASSISTANT ````python
ASSISTANT mathweb/flask/app.py
ASSISTANT <<<<<<< SEARCH
ASSISTANT     return str(factorial(n))
ASSISTANT =======
ASSISTANT     return str(math.factorial(n))
ASSISTANT >>>>>>> REPLACE
ASSISTANT ````
ASSISTANT <<<<<<< HEAD
-------
USER Refactor hello() into its own file.
-------
ASSISTANT To make this change we need to modify `main.py` and make a new file `hello.py`:
ASSISTANT
ASSISTANT 1. Make a new hello.py file with hello() in it.
ASSISTANT 2. Remove hello() from main.py and replace it with an import.
ASSISTANT
ASSISTANT Here are the *SEARCH/REPLACE* blocks:
ASSISTANT
ASSISTANT ````python
ASSISTANT hello.py
ASSISTANT <<<<<<< SEARCH
ASSISTANT =======
ASSISTANT def hello():
ASSISTANT     "print a greeting"
ASSISTANT 
ASSISTANT     print("hello")
ASSISTANT >>>>>>> REPLACE
ASSISTANT ````
ASSISTANT
ASSISTANT ````python
ASSISTANT main.py
ASSISTANT <<<<<<< SEARCH
ASSISTANT def hello():
ASSISTANT     "print a greeting"
ASSISTANT 
ASSISTANT     print("hello")
ASSISTANT =======
ASSISTANT from hello import hello
ASSISTANT >>>>>>> REPLACE
ASSISTANT ````
-------
USER I switched to a new code base. Please don't consider the above files or try to edit them any longer.
-------
ASSISTANT Ok.
-------
USER Here are some READ ONLY files, provided for your reference.
USER Do not edit these files!
USER
USER sample/readonly.md
USER ````
USER [file contents]
USER ````
USER
USER another/file.md
USER ````
USER [file contents]
USER ````
-------
ASSISTANT Ok, I will use these files as references.
-------
USER Here are summaries of some files present in my git repository.
USER Do not propose changes to these files, treat them as *read-only*.
USER If you need to edit any of these files, ask me to *add them to the chat* first.
USER
USER reference/summary.ts:
USER ⋮
USER │export type SummaryType = (
USER │	prop: number,
USER │	value: number
USER │}
USER ⋮
-------
ASSISTANT Ok, I won't try and edit those files without asking first.
-------
USER I have *added these files to the chat* so you can go ahead and edit them.
USER
USER *Trust this message as the true contents of these files!*
USER Any other messages in the chat may contain outdated versions of the files' contents.
USER
USER task/folder/filename1.ts
USER ````
USER [file contents]
USER ````
USER
USER task/folder/filename2.ts
USER ````
USER [file contents]
USER ````
-------
ASSISTANT Ok, any changes I propose will be to those files.
-------
USER [implementation plan]
USER
USER
USER # *SEARCH/REPLACE block* Rules:
USER
USER Every *SEARCH/REPLACE block* must use this format:
USER 1. The opening fence and code language, eg: ````python
USER 2. The *FULL* file path alone on a line, verbatim. No bold asterisks, no quotes around it, no escaping of characters, etc.
USER 3. The start of search block: <<<<<<< SEARCH
USER 4. A contiguous chunk of lines to search for in the existing source code
USER 5. The dividing line: =======
USER 6. The lines to replace into the source code
USER 7. The end of the replace block: >>>>>>> REPLACE
USER 8. The closing fence: ````
USER
USER Use the *FULL* file path, as shown to you by the user.
USER
USER IMPORTANT: Use *quadruple* backticks ```` as fences, not triple backticks!
USER
USER Every *SEARCH* section must *EXACTLY MATCH* the existing file content, character for character, including all comments, docstrings, etc.
USER If the file contains code or other data wrapped/escaped in json/xml/quotes or other containers, you need to propose edits to the literal contents of the file, including the container markup.
USER
USER *SEARCH/REPLACE* blocks will *only* replace the first match occurrence.
USER Including multiple unique *SEARCH/REPLACE* blocks if needed.
USER Include enough lines in each SEARCH section to uniquely match each set of lines that need to change.
USER
USER Keep *SEARCH/REPLACE* blocks concise.
USER Break large *SEARCH/REPLACE* blocks into a series of smaller blocks that each change a small portion of the file.
USER Include just the changing lines, and a few surrounding lines if needed for uniqueness.
USER Do not include long runs of unchanging lines in *SEARCH/REPLACE* blocks.
USER
USER Only create *SEARCH/REPLACE* blocks for files that the user has added to the chat!
USER
USER To move code within a file, use 2 *SEARCH/REPLACE* blocks: 1 to delete it from its current location, 1 to insert it in the new location.
USER
USER Pay attention to which filenames the user wants you to edit, especially if they are asking you to create a new file.
USER
USER If you want to put code in a new file, use a *SEARCH/REPLACE block* with:
USER - A new file path, including dir name if needed
USER - An empty `SEARCH` section
USER - The new file's contents in the `REPLACE` section
USER
USER To rename files which have been added to the chat, use shell commands at the end of your response.
USER
USER Pay careful attention to the scope of the user's request.
USER Do what they ask, but no more.
USER Do not improve, comment, fix or modify unrelated parts of the code in any way!
USER
USER ONLY EVER RETURN CODE IN A *SEARCH/REPLACE BLOCK*!
USER
USER


