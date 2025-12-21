/**
 * LLM-as-Judge Module
 *
 * Exports the judge framework and all criteria sets for evaluating agent outputs.
 */

export {
	// Core framework
	evaluateWithJudge,
	passingScore,
	formatJudgeResult,
	createMockJudgeResult,
	assertJudgeResultMeetsExpectations,
	MINIMUM_PASSING_SCORE,
	// Criteria sets
	INITIALIZER_CRITERIA,
	WORKER_CRITERIA,
	REVIEW_CRITERIA,
	PARALLEL_CRITERIA,
	// Types
	type JudgeResult,
	type JudgeCriterion,
	type JudgeContext,
} from './judgeFramework';
