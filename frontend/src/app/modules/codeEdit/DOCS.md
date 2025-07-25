# Code Editing Spec


The functionality is focused around interactively editing a single file, with an easy way to select other files to include in the context.


# Initial Setup

On component initialization, the file system tree is fetched from the server. This is done using the `codeEditService.getFileSystemTree()` method.

The file system tree is then displayed in a tree view, with checkboxes to select files for the LLM context, using the `mat-tree` component.

(The original tree code is in the `filesystem-tree` component. If you have having issues with the tree in code-edit.component.html, then check the code in `filesystem-tree.component.html` to see whats different.)

# Initial user interaction

## File system tree
Above the tree is a filter input field. 

- When the user types in the filter, the tree is filtered to only show files/folder that match the filter.
- The filter is case-insensitive.
- The filter is applied to the file name and folder name.
- If the filter starts with a / then the filter is applied to folders only.

When the user clicks a checkbox, it toggles the state.
- If the checkbox is checked
    - If a file is checked, the file is added to the LLM context.
    - If a folder is checked, all files in the folder, and subfolders are added to the LLM context.
- If the checkbox is unchecked
    - If a file is unchecked, the file is removed from the LLM context.
    - If a folder is unchecked, all files in the folder, and subfolders are removed from the LLM context.
- Folder nodes should display a partially selected state if some of the files in the folder are selected (how can we do this?)

When the file selection changes it should be saved to local storage
On component load the selection should be restored from local storage

## Selected files table

Selected files (not folders) are added to the table in the top right split panel. The table has the following columns:
- View
- File Path
- File Size (in tokens)
- Remove

Clicking remove is the same as unchecking the file in the tree.

## Instructions form

The instructions form is a simple text area that allows the user to enter instructions for the LLM.

- The instructions should be validated to ensure they are not empty.

On submission the selected files are sent to the LLM with the instructions of the edits to make

