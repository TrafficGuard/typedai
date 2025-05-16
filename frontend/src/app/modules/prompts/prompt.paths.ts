// frontend/src/app/modules/prompts/prompt.paths.ts

// Internal constants for constructing paths. These are not exported directly.
const _MODULE_ABSOLUTE_BASE = '/ui/prompts';

const _SEGMENT_LIST = ''; // The root of the prompts module
const _SEGMENT_NEW = 'new';
const _SEGMENT_EDIT = 'edit';
const _PARAM_PROMPT_ID = ':promptId'; // Route parameter placeholder

export const PROMPTS_ROUTES = {
  // --- For route definitions in prompts.routes.ts ---
  // These provide the string segments needed for the `path` property in route configurations.

  /** Path for the prompt list view (root of the module). */
  PATH_LIST: _SEGMENT_LIST,

  /** Path for creating a new prompt. */
  PATH_NEW: _SEGMENT_NEW,

  /** Path segment for editing a prompt (used relative to a prompt ID). */
  PATH_EDIT_SEGMENT: _SEGMENT_EDIT,

  /** Route parameter name for prompt ID. */
  PATH_PARAM_PROMPT_ID: _PARAM_PROMPT_ID,

  /** Combined path for the prompt detail view (e.g., ':promptId'). */
  PATH_DETAIL: _PARAM_PROMPT_ID,

  /** Combined path for editing a prompt (e.g., ':promptId/edit'). */
  PATH_EDIT: `${_PARAM_PROMPT_ID}/${_SEGMENT_EDIT}`,


  // --- For programmatic navigation (router.navigate) and routerLink in components ---
  // These functions return arrays of path segments, suitable for Angular's router.
  // They construct absolute paths from the module's root.

  /**
   * Returns the route array for the prompts list page.
   * Example: `['/ui/prompts']`
   */
  list: (): string[] => [_MODULE_ABSOLUTE_BASE],

  /**
   * Returns the route array for the 'create new prompt' page.
   * Example: `['/ui/prompts', 'new']`
   */
  new: (): string[] => [_MODULE_ABSOLUTE_BASE, _SEGMENT_NEW],

  /**
   * Returns the route array for a specific prompt's detail page.
   * @param promptId The ID of the prompt.
   * Example: `['/ui/prompts', 'some-prompt-id']`
   */
  detail: (promptId: string): string[] => [_MODULE_ABSOLUTE_BASE, promptId],

  /**
   * Returns the route array for a specific prompt's edit page.
   * @param promptId The ID of the prompt.
   * Example: `['/ui/prompts', 'some-prompt-id', 'edit']`
   */
  edit: (promptId: string): string[] => [_MODULE_ABSOLUTE_BASE, promptId, _SEGMENT_EDIT],

  /**
   * Returns the relative route array for navigating to the edit page from a detail page.
   * This is for use with `{ relativeTo: activatedRoute }`.
   * Example: `['edit']`
   */
  editRelative: (): string[] => [_SEGMENT_EDIT],
};
