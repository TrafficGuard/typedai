import { func, funcClass } from '#functionSchema/functionDecorators';
import { execCommand, failOnError } from '#utils/exec';

/**
 * This is for quickly creating ad-hoc temporary functions for your agents
 */
@funcClass(__filename)
export class CustomFunctions {}
