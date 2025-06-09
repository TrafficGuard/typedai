/**
 * Custom error types for the SWE agents.
 */

export class CoderExhaustedAttemptsError extends Error {
	constructor(
		message: string,
		public readonly attempts: number,
		public readonly lastReflection: string,
	) {
		super(message);
		this.name = 'CoderExhaustedAttemptsError';
		Object.setPrototypeOf(this, CoderExhaustedAttemptsError.prototype);
	}
}

export class CompilationError extends Error {
	constructor(
		public readonly compileOutput: string,
		public readonly command: string,
		public readonly stdout: string,
		public readonly stderr: string,
		public readonly exitCode: number,
	) {
		super(`Compilation failed with command: ${command}`);
		this.name = 'CompilationError';
		Object.setPrototypeOf(this, CompilationError.prototype);
	}
}
