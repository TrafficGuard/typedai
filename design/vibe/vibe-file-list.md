# File Selection Review Page

**Goal:** Allow users to review, modify, and approve the file selection (which will be passed to the code editing agent) made by the AI.

## Parent Component Route
/vibe/:sessionId
frontend/src/app/modules/vibe/vibe.component.ts is responsible for checking the state of the VibeSession and displaying the appropriate sub-component.
When the status (VibeStatus in vibeTypes.ts) is `file_selection_review` or `updating_file_selection` then vibe.component.html will display the vibe-file-list component.

# vibe-file-list.component functionality

## OnLoad
- Fetch the VibeSession data
- Fetch the repository file tree

## Vibe File List UI

### Main screen

Selected files [table]
|| Path | Reason | Category | Delete ||

Search files [textfield] (Add)[button]

(Show files)[link]

== form
File Selection Update Instructions
[textarea]

(Submit)[button]
==

(Save)[button]               (Reset Selection)[button]

(Save and Generate Design)[button]

### Show files screen

Filter [textarea]

Files[tree]

(Cancel)[button] Select[button]

## Notes

On the main screen
- If the user click on a reason in the table it will show a modal dialog with the reason text to edit.
- If the user click on a category in the table it will switch the text to a dropdown. If a value is selected or the user clicks out of the dropdown then it goes back to just text

When the user types in the Search files text field it will autocomplete and in the autocomplete preview list show a selection (upto 10)
The autocomplete matching should match on prefixes of snake or camel case, or dot, dash or underscore seperators.
For example if the file list includes the name
vibe-file-list.component.ts
then if the user has typed vf, vfl or vflc then it should match

When the user clicks on the Show files link the component will display only the whole the repository file system tree in a selectable list
The filter textarea will filter the list with the same filename part prefix matching rules as the Search files autocomplete
The Select button will close the file system overlay add the files to selection list showing table (without saving)

The File Selection Update Instructions form is submitted, or the save buttons are clicked there will be a spinner overlay preventing actions while the submission is in progress.


Display the selected files list
**Display Selected Files:**
*   Use `MatTable` to display `session.fileSelection`.
*   Columns: File Path (`filePath`), Reason (`reason`), Category (`category`), Actions (e.g., Remove button). (Ref: `vibe.types.ts::SelectedFile`).
*   The `category` field from `selectFilesAgent.ts` should be populated by the agent.
**Add Files:**
*   Use `MatFormField` with `MatAutocomplete`.
*   Input source for autocomplete should be the list of all file paths derived from the fetched file tree (`FileSystemNode[]`). Implement filtering as the user types.
*   On selection, add the file path to a temporary list or directly update the session via PATCH. If updating directly, refetch session data. Consider requiring a reason/category upon adding.
*   **Remove Files:** Clicking the remove button next to a file in the table should update the `session.fileSelection` via `PATCH /api/vibe/:sessionId`. Refetch session data.
*   **Refine Selection with Prompt:**
    *   Provide a `MatInput` (textarea) for the user to enter a refinement prompt.
    *   Add a "Refine Selection" button. Clicking it calls a new method in `vibeService.ts` (frontend) which hits `POST /api/vibe/:sessionId/update-selection` with the prompt.
    *   The UI should indicate processing (e.g., disable buttons, show spinner) and poll for status change back to `file_selection_review` or `error_file_selection`.
*   **Generate Detailed Design:**
    *   Provide a `MatFormField` with `MatSelect` for choosing the number of design variations (e.g., 1 to 3). Default to 1.
    *   Add a "Generate Detailed Design" button. Clicking it calls a new method in `vibeService.ts` (frontend) which hits `POST /api/vibe/:sessionId/generate-design` with the selected variation count.
    *   The UI should navigate to the Detailed Design Review page (`/vibe/design-review/:sessionId`) or an intermediate loading page while the design is generated.
*   **State Management:** Disable/enable UI elements based on `session.status`. For example, disable "Generate Detailed Design" if status is `updating_selection`.