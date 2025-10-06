import { AsyncLocalStorage } from 'node:async_hooks';
import type { User } from '#shared/user/user.model';

// Lazy accessors – use require() to defer evaluation until first call.
// This avoids running #agent/… (which indirectly imports functionDecorators)
// before this module finishes initialising.
function agentCtx() {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	return (require('#agent/agentContextLocalStorage') as typeof import('#agent/agentContextLocalStorage')).agentContext();
}

function appCtx() {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	return (require('#app/applicationContext') as typeof import('#app/applicationContext')).appContext();
}

// Fallback when AsyncLocalStorage context is lost (e.g. across gRPC, OTEL spans, etc.)
let _fallbackUser: User | null = null;

const userContextStorage = new AsyncLocalStorage<User>();

/**
 * Sets the user on an AsyncLocalStorage store so the user available via the currentUser() function for the duration of the provided function call
 * @param user the user set for the function execution
 * @param fn the function which will have the user available via currentUser() during execution
 * @returns The return value of the provided function `fn`.
 */
export function runAsUser<T>(user: User, fn: () => T): T {
	return userContextStorage.run(user, fn as any) as T;
}

const _singleUser: boolean = !process.env.AUTH || process.env.AUTH === 'single_user';

export function isSingleUser(): boolean {
	return _singleUser;
}

/**
 * @returns If called in an agent's execution, returns the agent's user, otherwise the user from a web request, or the single user if in single user mode.
 */
export function currentUser(): User {
	// 1. Prefer user set in AsyncLocalStorage
	const user = userContextStorage.getStore();
	if (user) return user;

	// 2. Fallback to user that was explicitly set via setCurrentUser()
	if (_fallbackUser) return _fallbackUser;

	// 3. Existing agent-execution context fallback
	const agent = agentCtx();
	if (agent) return agent.user;

	// 4. Single-user / error handling
	if (isSingleUser()) {
		return appCtx().userService.getSingleUser();
	}
	throw new Error('User has not been set on the userContextStorage');
}

/**
 * Gets the current users configuration for a function class
 * @param functionClass The function class
 */
export function functionConfig(functionClass: any): Record<string, any> {
	const functionConfig: Record<string, Record<string, any>> = currentUser()?.functionConfig;
	if (!functionConfig) return {};
	return functionConfig[functionClass.name] ?? {};
}

/**
 * FOR TESTING PURPOSES ONLY. Sets the current user in the AsyncLocalStorage.
 * @param user The user to set, or null to clear.
 */
export function setCurrentUser(user: User | null): void {
	if (user) {
		userContextStorage.enterWith(user);
		_fallbackUser = user;
	} else {
		_fallbackUser = null;
		// Exiting the store is tricky, re-entering with undefined might be the way
		// but for tests, simply entering with null/undefined might suffice if the test runner isolates contexts.
		// A more robust approach might involve explicitly managing the store's lifecycle per test.
		// For now, let's assume setting null works for the test context.
		userContextStorage.enterWith(undefined as any); // Or handle cleanup differently if needed
	}
}
