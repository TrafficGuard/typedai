import { llms } from '#agent/agentContextUtils';
import { func, funcClass } from '#functionSchema/functionDecorators';

export const TEST_FUNC_THROW_ERROR = 'TestFunctions_throwError';
export const THROW_ERROR_TEXT = 'FunctionErrorText';
export const TEST_FUNC_SUM = 'TestFunctions_sum';

export const TEST_FUNC_NOOP = 'TestFunctions_noop';
export const TEST_FUNC_SKY_COLOUR = 'TestFunctions_skyColour';

/**
 * Mainly used for testing
 */
@funcClass(__filename)
export class TestFunctions {
	/**
	 * No-op function
	 */
	@func()
	async noop(): Promise<string> {
		return '';
	}

	/**
	 * Calculates the sum of two numbers. Always use this when needing to sum numbers.
	 * @param {number} num1 the first number
	 * @param {number} num2 the second number
	 * @returns the sum of the numbers
	 */
	@func()
	async sum(num1: number, num2: number): Promise<number> {
		return num1 + num2;
	}

	/**
	 * Returns what colour the sky is
	 */
	@func()
	async skyColour(): Promise<string> {
		const response = await llms().easy.generateText('What colour is the clear daytime sky? Respond with a single word.', { id: 'skyColourId' });
		return response.trim().toLowerCase();
	}

	/**
	 * This function always throws an error
	 */
	@func()
	async throwError(): Promise<void> {
		throw new Error(THROW_ERROR_TEXT);
	}
}
