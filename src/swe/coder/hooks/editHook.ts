import type { EditSession } from '../editSession';

export interface HookResult {
	ok: boolean;
	message?: string;
	additionalFiles?: string[];
}
export interface EditHook {
	name: string;
	run(session: EditSession): Promise<HookResult>;
}
