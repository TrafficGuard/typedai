# Product Design Document: Vibe Coding Session

## 1. Introduction

This document outlines the product design for enhancing the "Vibe" AI-assisted coding session feature. 
The goal is to create a more structured and interactive development workflow where users can guide and review the AI's process at key stages, 
specifically during file selection, design proposal and review.

**Goals:**

*   Introduce session creation presets.
*   Implement distinct user review steps for file selection and design proposal.
*   Enable user interaction (manual adjustments, prompt-based refinement) at review steps.
*   Integrate existing AI agents (`selectFilesAgent`, `codeEditingAgent`) into the workflow.
*   Provide a clear state machine and UI flow for the Vibe session lifecycle.

**References:**

*   **Frontend Wizard:** `frontend/src/app/modules/vibe/new-vibe-wizard/new-vibe-wizard.component.ts`
*   **Frontend Service:** `frontend/src/app/modules/vibe/vibe.service.ts`
*   **Frontend Types:** `frontend/src/app/modules/vibe/vibe.types.ts`
*   **Backend Routes:** `src/routes/vibe/vibeRoutes.ts`
*   **Backend Service Interface:** `src/vibe/vibeService.ts`
*   **Backend Types:** `src/vibe/vibe.model.ts`
*   **Agents:** `src/swe/discovery/selectFilesAgent.ts`, `src/swe/codeEditingAgent.ts`
*   **Utilities:** `src/functions/storage/fileSystemService.ts`, `src/functions/scm/git.ts`, `src/functions/scm/sourceControlManagement.ts`

## 2. Current State

Based on the provided files:

1.  **Session Creation:** Users initiate a session via the `NewVibeWizardComponent`. They provide a title, instructions, select a repository (local, GitHub, GitLab), target branch, and configure the working branch (`new`, `existing`, `target`). (Ref: `new-vibe-wizard.component.ts`, `vibeRoutes.ts`, `CreateVibeSessionBodySchema`).
2.  **Backend Initialization:** Upon creation (`POST /api/vibe`), the `FirestoreVibeRepository` saves the session with status `initializing`. It then *asynchronously triggers a mock agent* (`runInitialSetupAgent`) which simulates cloning, file selection, and initial design generation. On mock completion, it updates the status to `file_selection_review` and populates `fileSelection` and `designAnswer`. (Ref: `firestoreVibeRepository.ts`, `vibe.model.ts::VibeStatus`).
3.  **Data Storage:** Sessions and Presets are stored in Firestore under user-specific subcollections. (Ref: `firestoreVibeRepository.ts`).
4.  **Workflow Actions:** API routes exist for various workflow steps (`update-selection`, `generate-design`, `update-design-prompt`, `execute-design`), but the backend implementation (`firestoreVibeRepository.ts`) currently uses mock agent runners for these actions.
5.  **UI Components:** Basic components exist for listing selected files (`vibe-file-list.component.ts`) and displaying/editing a design proposal (`vibe-design-proposal.component.ts`).
6.  **File System Access:** Backend routes (`GET /:sessionId/tree`, `GET /:sessionId/file`) are defined for accessing the session's workspace file structure and content. The `FileSystemService` provides the underlying capability. (Ref: `vibeRoutes.ts`, `fileSystemService.ts`).

## 3. Proposed Enhancements

### 3.1 Session Creation Presets

*   **Goal:** Allow users to save and load common session configurations (repository, branches) to speed up creation.
*   **UI Changes (`new-vibe-wizard.component.ts`):**
    *   Add a "Load Preset" dropdown/button. Selecting a preset populates the repository source, ID, name, target branch, working branch action/name, and shared repo flag.
    *   Add a "Save as Preset" button/option (potentially after successful submission or within the form) that prompts for a preset name.
    *   Consider a separate "Manage Presets" page/modal accessible from the wizard or user profile, allowing users to view, rename, and delete presets (`listVibePresets`, `deleteVibePreset` from `vibeService.ts` frontend).
*   **API:** Existing backend CRUD routes and service methods for presets (`/api/vibe/presets`) seem sufficient. (Ref: `vibeRoutes.ts`, `vibeService.ts`, `firestoreVibeRepository.ts`).
*   **Backend:** No major changes needed beyond ensuring the existing preset logic works correctly.

## 4. Workflow / State Machine

The Vibe session status (`VibeStatus` in `src/vibe/vibe.model.ts`) will transition as follows:

1.  **`initializing`**: (Start) Session created. Backend clones repo, runs `selectFilesAgent`, generates initial design.
    *   *On Success:* -> `file_selection_review`
    *   *On Failure:* -> `error_file_selection` or `error_design_generation`
2.  **`file_selection_review`**: User reviews initial file selection.
    *   *User Edits + Generate Design:* -> `generating_design` (via `POST /generate-design`)
    *   *User Submits Prompt:* -> `updating_selection` (via `POST /update-selection`)
    *   *User Accepts + Generate Design:* -> `generating_design` (via `POST /generate-design`)
3.  **`updating_selection`**: Backend runs `selectFilesAgent` with prompt.
    *   *On Success:* -> `file_selection_review`
    *   *On Failure:* -> `error_file_selection`
4.  **`generating_design`**: Backend runs design generation agent.
    *   *On Success:* -> `design_review_details`
    *   *On Failure:* -> `error_design_generation`
5.  **`design_review_details`**: User reviews the detailed design.
    *   *User Edits + Saves:* Stays in `design_review_details` (via `PATCH /:sessionId`).
    *   *User Submits Prompt:* -> `updating_design` (via `POST /update-design-prompt`)
    *   *User Accepts + Executes:* -> `coding` (via `POST /execute-design`)
6.  **`updating_design`**: Backend runs design agent with prompt.
    *   *On Success:* -> `design_review_details`
    *   *On Failure:* -> `error_design_generation`
7.  **`coding`**: Backend runs `codeEditingAgent`.
    *   *On Success:* -> `code_review`
    *   *On Failure:* -> `error_coding`
8.  **`code_review`**: User reviews the generated code diff.
    *   *User Submits Comments:* -> `coding` (via `POST /update-code`)
    *   *User Accepts + Commits:* -> `committing` (via `POST /commit`)
9.  **`committing`**: Backend commits changes, pushes branch, potentially creates PR.
    *   *On Success (No CI):* -> `completed`
    *   *On Success (CI Monitored):* -> `monitoring_ci`
    *   *On Failure:* -> `error_coding` (or specific commit error state)
10. **`monitoring_ci`**: (Future) Backend monitors CI pipeline.
    *   *On Success:* -> `completed`
    *   *On Failure:* -> `ci_failed`
11. **`ci_failed`**: (Future) User reviews CI failure, potentially triggers AI fix.
    *   *User Applies Fix:* -> `coding` (or `applying_fix`) (via `POST /apply-cicd-fix`)
12. **`completed`**: Workflow finished successfully.
13. **`error_*` / `error`**: Terminal error state. User might be able to retry from a previous step depending on the error.


When editing any files in the folder the file selection agent should always include
- src/vibe/vibeService.ts
- src/routes/vibe/vibeRoutes.ts
- src/vibe/vibe.model.ts


## 8. Open Questions / Future Considerations

*   **Real-time Updates:** Should the frontend use WebSockets instead of polling for status updates?
*   **Error Recovery:** How should users recover from agent errors? Allow retry from the failed step?
*   **CI/CD Integration:** Detailed design for `monitoring_ci` and `ci_failed` states, including how CI results are obtained and how AI fixes are proposed/applied.
*   **Agent Complexity:** Will the initial setup require multiple distinct agent calls (select files, then generate design) or a single complex agent?
*   **Design Variations:** How should multiple design variations be presented to the user for review?
*   **Workspace Cleanup:** Strategy for cleaning up cloned repositories associated with sessions.
*   **Cost Tracking:** Integrate LLM cost tracking per session/step.
*   **Security:** Ensure robust authorization checks for all API endpoints and workspace access.