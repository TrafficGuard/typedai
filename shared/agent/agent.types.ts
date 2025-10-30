// We use this in trace.ts to minimise dependencies on agent model and its imports on startup
export interface HasCallStack {
	callStack: string[];
}
