import { EventEmitter } from 'node:events';

/**
 * A global EventEmitter for SearchReplaceCoder session events.
 *
 * Available events:
 * - 'applied': Fired after edits are successfully applied and all hooks pass.
 *   Payload: { files: string[] } - Array of relative file paths that were modified.
 * - 'hook-failed': Fired when a post-edit hook fails.
 *   Payload: { hook: string, msg?: string } - Name of the failed hook and an optional message.
 *
 * Note: When using in tests, ensure listeners are detached (e.g., in afterEach)
 * to prevent memory leaks or cross-test interference if the emitter is not reset.
 */
export const sessionEvents = new EventEmitter();
