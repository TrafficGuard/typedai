# Product Design Document: New Code Task

## 1. Introduction

### 1.1. Goal:
Provide a user interface for creating new Code tasks, configuring project source, branches, and instructions, and utilizing presets for efficiency.

### 1.2. Scope:
*   **In Scope:** UI for codeTask creation form; selection of Local, GitHub, GitLab sources; configuration of target and working branches; triggering codeTask creation; loading and saving codeTask presets based on form configuration; validation.
*   **Out of Scope:** Post-initialization Code Task workflow steps; user profile management;.

### 1.4. References:
*   Overall Code Task Workflow PDD
*   UI Mockup (Text-based version provided)

## 2. User Requirements & Behaviors

### 2.1. Form Fields & Initial State:
*   Users must provide a "Title" (text) and "Instructions" (textarea). Both are required.
*   Users can optionally select a "Preset" from a dropdown. Presets load asynchronously.
*   Users must select a "Repository Source" (radio buttons: Local, GitHub, GitLab). Default is Local. GitHub/GitLab options are disabled until their respective project lists have finished loading.
*   Based on the source, a "Repository" dropdown appears (labeled "Local Repository Path", "GitHub Repository", or "GitLab Repository"). This is required. Repositories load asynchronously based on the selected source.
*   Users must select a "Target Branch" (dropdown for SCM, text input for Local). This is required. Options load asynchronously after a repository is selected (SCM only). This field is disabled until a repository is selected (and branches loaded for SCM).
*   Users must configure the "Working Branch Option" (radio buttons):
    *   "Use target branch".
    *   "Use existing branch": Requires selecting a branch from a dropdown (SCM only). Disabled until repo selected & branches loaded (SCM).
    *   "Create new branch": Requires entering a name in a text field. This is the default option. Input is validated against existing branch names (SCM only).
*   Users can optionally check "Use Shared Repositories". This is disabled if the source is Local.

### 2.2. Dynamic Form Behavior:
*   Selecting a Preset populates Repository Source, Repository, Target Branch, Working Branch Option/Value, and Use Shared Repos fields. A warning is shown if the preset's repository cannot be found in the current list.
*   Changing Repository Source resets the Repository, Target Branch, and Working Branch selections/inputs.
*   Selecting a Repository populates and enables the Target Branch dropdown (SCM) and the Existing Branch dropdown (if that option is selected). It resets previous branch selections.
*   Selecting a Working Branch Option enables/disables and sets validation rules for the corresponding input field (Existing Branch dropdown or New Branch Name input).

### 2.3. Actions:
*   **Save Preset:** Users can click "Save as Preset". They are prompted for a name. The current form configuration (excluding Title/Instructions) is saved. This button is disabled if the form is invalid. Feedback (success/error) is provided.
*   **Start Code Task:** Users can click "Start Code Task". This button is disabled if the form is invalid.
    *   On click (if valid), a request is made to create the codeTask object in the repository and trigger the repository initialisation in the background.
    *   A loading indicator is shown.
    *   On success, the user is navigated to the code task page (`/codeTask/:codeTaskId`).
      *  The codeTask.component.ts should then display the "Initializing" state component
    *   On failure, an error message is displayed.

### 2.4. Error Handling & Feedback:
*   Loading states are indicated while presets, repositories, and branches are fetched.
*   Validation errors are displayed next to the relevant form fields (e.g., required field empty, new branch name already exists).
*   Feedback for failed operations (loading data, saving preset, starting codeTask) is displayed (e.g., via Snackbar).

## 3. Future Considerations

*   Modal dialog for preset management (delete/rename).
*   Enhanced validation feedback (e.g., async checks).

---

# Technical Design Document: New Code Task

## 1. Introduction

### 1.1. Goal:
Define the technical components and interactions for the New Code Task Wizard, focusing on testable behaviors and service collaborations.

### 1.2. Scope:
Frontend component behavior, Backend API endpoints and service orchestration for wizard interactions and codeTask initiation.

### 1.3. References:
*   `codeTask.model.ts`, `CodeTaskService` Interface, `CodeTaskRepository` Interface, `SCM Tool` Interface, Agent Interfaces.

## 2. Frontend (`NewCodeTaskComponent`) - Testable Behaviors

### 2.1. Initialization & Data Loading:
*   On initialization, the component fetches user presets by calling `CodeTaskService.listCodeTaskPresets()`.
*   On initialization, the component fetches local repositories by calling `WorkflowsService.getRepositories()`.
*   On initialization, the component fetches SCM projects by calling `CodeTaskService.getScmProjects()`.
*   *Testable:* Verify loading indicators are shown during fetches. Verify preset/repo dropdowns are populated upon successful API responses. Verify error messages are displayed on API failures. Verify GitHub/GitLab source options are disabled until `getScmProjects` completes.

### 2.2. User Interactions & Form Logic:
*   Selecting a Preset: Populates form controls based on the preset's config. Triggers branch fetching if needed (via repository selection).
    *   *Testable:* Verify form fields match preset config after selection. Verify `CodeTaskService.getScmBranches` is called if an SCM repo is selected via preset. Verify warning shown if preset repo not found.
*   Changing Repository Source: Resets dependent form controls (Repository, Branches). Disables/enables 'Use Shared Repos' checkbox.
    *   *Testable:* Verify relevant form controls are reset. Verify 'Use Shared Repos' enabled state changes correctly.
*   Selecting a Repository (SCM): Triggers fetching of branches by calling `CodeTaskService.getScmBranches(source, repoId)`. Resets branch form controls.
    *   *Testable:* Verify `CodeTaskService.getScmBranches` is called with correct parameters. Verify branch dropdowns are populated on success. Verify branch controls are reset initially. Verify Target Branch/Existing Branch controls are enabled after branches load.
*   Changing Working Branch Option: Enables/disables and adjusts validation for the relevant input (Existing Branch dropdown or New Branch Name input).
    *   *Testable:* Verify correct input field is enabled/disabled based on selection. Verify `required` validator is added/removed appropriately. Verify async validator (for branch name existence) is added/removed for 'Create new branch' (SCM only).
*   Entering New Branch Name (SCM): Triggers async validation against the current list of fetched branches.
    *   *Testable:* Verify form control enters pending state during check. Verify `branchExists` error is set if name matches an existing branch.
*   Clicking "Save Preset": If form is valid, prompts for name. Calls `CodeTaskService.saveCodeTaskPreset(name, config)` with configuration derived from the current form state.
    *   *Testable:* Verify prompt appears. Verify `CodeTaskService.saveCodeTaskPreset` is called with correctly mapped config data if name provided. Verify success/error feedback is shown. Verify button is disabled when form is invalid.
*   Clicking "Start Code Task": If form is valid, calls `CodeTaskService.createCodeTask(payload)` with payload derived from the current form state. Navigates to `/codeTask/initialise/:id` on success.
    *   *Testable:* Verify `CodeTaskService.createCodeTask` is called with correctly mapped payload. Verify navigation occurs on success. Verify error feedback shown on failure. Verify button is disabled when form is invalid or during submission.

### 2.3. Validation:
*   Required fields (Title, Instructions, Repo, Target Branch, specific Working Branch input) are marked invalid if empty.
*   New Branch Name (SCM) is marked invalid if it matches an existing branch name after async validation.
*   *Testable:* Verify form validity state reflects required field status. Verify 'Start'/'Save Preset' buttons' disabled state reflects form validity. Verify async validation correctly identifies existing branch names.

## 3. Backend

### 3.1. API Endpoints & Schemas (`codeTaskRoutes.ts`):
*   `POST /api/codeTask`: Accepts `CreateCodeTaskBodySchema`. Returns `CodeTaskResponseSchema` (201). Delegates to `CodeTaskService.createCodeTask`.
*   `GET /api/codeTask/presets`: Returns `PresetListResponseSchema` (200). Delegates to `CodeTaskService.listCodeTaskPresets`.
*   `POST /api/codeTask/presets`: Accepts `CreatePresetBodySchema`. Returns `CodeTaskPresetSchema` (201). Delegates to `CodeTaskService.saveCodeTaskPreset`.
*   `DELETE /api/codeTask/presets/:presetId`: Accepts `presetId` param. Returns 204. Delegates to `CodeTaskService.deleteCodeTaskPreset`.
*   `GET /api/codeTask/repositories/branches`: Accepts `source`, `id` query params. Returns `GetBranchesResponseSchema` (200). Delegates to `CodeTaskService.getBranchList`.
*   *(Other existing Code Task routes remain)*
*   Standard REST principles, error handling (4xx/5xx), and schema validation (TypeBox) apply.

### 3.2. Service Orchestration (`CodeTaskServiceImpl`)
*   **`createCodeTask(userId, codeTaskData)`:**
    *   Orchestrates codeTask creation:
        1.  Generates codeTask ID and timestamps.
        2.  Persists initial codeTask data (status `initializing`) via `CodeTaskRepository.createCodeTask`.
        3.  **Asynchronously** triggers the background initialization process (`triggerBackgroundInitialization`).
        4.  Returns the initially created codeTask object.
*   **`triggerBackgroundInitialization(userId, codeTaskId)`:** (Private, async)
    *   Orchestrates repository setup and initial agent run:
        1.  Retrieve codeTask data via `CodeTaskRepository.getCodeTask`.
        2.  Retrieve user data via `UserService.getUser`.
        3.  Determine the correct workspace path based on codeTask configuration (`useSharedRepos`).
            3.1. If useSharedRepos is false `systemDir()/codeTask/${codeTask.id}/${scmType}/${gitProject.namespace}/${gitProject.name}`
            3.2. If useSharedRepos is true `systemDir()/${scmType}/${gitProject.namespace}/${gitProject.name}`
        4.  Interact with the configured `SCM Tool` service/interface to clone or update the repository (`scmTool.cloneProject`).
        5.  Obtain a `VersionControlSystem` interface (e.g., via `FileSystemService` initialized for the workspace).
        6.  Use `VersionControlSystem` interface to checkout `targetBranch`, optionally create `workingBranch`, and switch to `workingBranch`.
        7.  Invoke `runCodeTaskWorkflowAgent` to execute the file selection step, providing the `selectFilesAgent` and codeTask instructions.
        8.  On successful agent completion: Update codeTask status to `file_selection_review` and store `fileSelection` via `CodeTaskRepository.updateCodeTask`.
        9.  On any failure during this process: Update codeTask status to an appropriate error state (`error_file_selection`, `error`) and store the error message via `CodeTaskRepository.updateCodeTask`.
*   **`saveCodeTaskPreset(userId, name, config)`:** Delegates persistence to `CodeTaskRepository.saveCodeTaskPreset`.
*   **`listCodeTaskPresets(userId)`:** Delegates retrieval to `CodeTaskRepository.listCodeTaskPresets`.
*   **`deleteCodeTaskPreset(userId, presetId)`:** Delegates deletion to `CodeTaskRepository.deleteCodeTaskPreset`.
*   **`getBranchList(userId, source, repoId)`:** Delegates branch retrieval to the appropriate `SCM Tool` or local repository interaction logic. *(Placeholder in current code)*.
*   *(Other service methods delegate to respective repositories or trigger other agent workflows)*.

### 3.3. Data Models (`codeTask.model.ts`):
Define shared types (`CodeTask`, `CodeTaskPreset`, `SelectedFile`, etc.) used across frontend, backend service, and repository layers.

### 3.4. Key Dependencies:
import {systemDir} from '#app/appVars'
`CodeTaskRepository` (Data Persistence), `SCM Tool` Interface (Git operations), `VersionControlSystem` Interface (Branch operations), `FileSystemService` (Workspace access abstraction), `selectFilesAgent` (Initial file selection logic), `UserService` (User data).

## 4. Data Storage

The `CodeTaskRepository` interface abstracts the persistence mechanism (e.g., Firestore) for `CodeTask` and `CodeTaskPreset` data.

## 5. Error Handling (Backend)

*   Service methods validate input and state, throwing errors for invalid operations (caught by route handlers).
*   Route handlers translate service errors into appropriate HTTP responses (4xx/5xx).
*   The asynchronous `triggerBackgroundInitialization` process handles its own errors internally, updating the codeTask state in the repository rather than throwing errors back to the initial `createCodeTask` caller.

# UI Mockup

Title
[text]

Instructions
[textarea]

(Load preset)[select]

Repository Source [*] Local [*] GitHub [*] GitLab (GitHub and GitLab only enabled once the project have loaded)

Local repository path/GitHub project/GitLab project
[select]

Target branch
[select]

Working Branch Option
[*] Use target branch
[*] Use existing branch [select]
[*] Create new branch [text]

[x] Clone to shared folder (Only enabled for GitHub and GitLab)

(Start Code Task)[button]           (Save as preset)[button] (Manage presets)[button]

Note: save/mange preset buttons are right aligned
