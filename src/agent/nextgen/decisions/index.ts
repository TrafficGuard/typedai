/**
 * Decision System Module
 *
 * Exports for the decision tier system with AI pre-analysis.
 */

// Decision Manager (main entry point)
export {
	DecisionManager,
	createDecisionManager,
	type DecisionManagerConfig,
	type MakeDecisionInput,
	type MakeDecisionResult,
	type HumanInputCallback,
	type ParallelExplorationCallback,
} from './decisionManager';

// Decision Analyzer (AI pre-analysis for medium decisions)
export {
	DecisionAnalyzer,
	createDecisionAnalyzer,
	stringsToOptionDefinitions,
	buildDecisionFromAnalysis,
	type DecisionAnalyzerConfig,
	type DecisionAnalysisInput,
	type DecisionAnalysisResult,
	type OptionAnalysis,
} from './decisionAnalyzer';

// Decision Tier Classifier (heuristic classification)
export {
	classifyDecision,
	classifyDecisions,
	getHighestTier,
	requiresHumanInput,
	shouldRecord,
	mayTriggerParallel,
	getTierDisplayName,
	getTierColor,
	type DecisionInput,
	type ClassificationResult,
} from './decisionTierClassifier';
