export class MaxTokensError extends Error {
	constructor(
		public maxOutputTokens: number,
		public responseContent: string,
	) {
		super(`Response exceeded the maximum token of ${maxOutputTokens}`);
	}
}
