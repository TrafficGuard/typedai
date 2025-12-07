# Claude Agents SDK + Cerebras Integration Plan for NextGen Coding Agent

## Overview

Build a **wrapper around the Claude Agents SDK** that adds autonomous orchestration capabilities:
- **Primary Claude Agent** - Claude SDK handles the core coding work
- **Orchestration Layer** - Our wrapper intercepts responses, manages sessions, auto-continues
- **Parallel Exploration** - Fork sessions to try multiple design approaches simultaneously
- **Auto-Continue Logic** - Analyze "should I continue?" prompts and respond without human input
- **Review Stage** - Load guidelines + learnings, review branch diffs before merge
- **Cerebras Sub-Agents** - Fast LLMs for research, analysis, and review tasks

## Key Principles (from NEXT_GEN.md)

1. **Frequent compaction** - Compact when sub-tasks complete to maintain focus
2. **Background learning extraction** - Extract learnings on compaction for knowledge base
3. **Dedicated search sub-agents** - Utilize codebase awareness tools
4. **LLM flexibility** - Select LLMs optimizing for speed, intelligence, or cost
5. **Parallel work** - Git worktree native parallel tasks + `forkSession` for parallel exploration
6. **Optimized workflows** - Branch on sub-task, review mode before merge
7. **Auto-continue** - Intercept obvious continuation prompts, reduce human interruptions

## Architecture: Wrapper Around Claude Agent

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      ClaudeAgentOrchestrator                             │
│  - Wraps Claude SDK query() as the primary coding agent                 │
│  - Intercepts all responses for analysis                                │
│  - Manages session lifecycle (resume, fork, parallel exploration)       │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Response Interceptor                                │
│                                                                          │
│  For each Claude response:                                               │
│  1. Check for "should I continue?" prompts → Auto-continue analyzer     │
│  2. Check for design proposals → Fork session for parallel impl         │
│  3. Check for subtask completion → Trigger compaction + learning        │
│  4. Check for "I'm done" claims → Verify (compile/lint/test) first      │
│  5. Check for "ready to merge" → Trigger review stage                   │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ├─────────────────┬─────────────────┬─────────────────┐
         ▼                 ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ Auto-Continue │ │ Parallel Fork │ │ Compaction &  │ │ Completion    │ │ Review Stage  │
│ Analyzer      │ │ Manager       │ │ Learning      │ │ Verifier      │ │               │
│               │ │               │ │               │ │               │ │               │
│ Cerebras      │ │ forkSession() │ │ Existing      │ │ compile/lint/ │ │ guidelines +  │
│ analyzes if   │ │ for parallel  │ │ CompactionSvc │ │ test BEFORE   │ │ learnings +   │
│ continuation  │ │ design tries  │ │ LearningExtr  │ │ accepting     │ │ review diffs  │
│ is obvious    │ │               │ │ KnowledgeBase │ │ "done" claim  │ │ before merge  │
└───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
         │                 │                 │                 │
         ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Cerebras-Powered Sub-Agents                           │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ SearchAgent │  │ AnalysisAgt │  │ ContinueAgt │  │ ReviewAgent │    │
│  │ (Qwen3 32b) │  │ (Qwen3 235b)│  │ (Qwen3 32b) │  │ (Qwen3 235b)│    │
│  │             │  │             │  │             │  │             │    │
│  │ Fast code   │  │ Deep code   │  │ Analyze if  │  │ Review code │    │
│  │ search      │  │ analysis    │  │ "continue?" │  │ vs guidelines│   │
│  │ via fork    │  │ via fork    │  │ is obvious  │  │ & learnings │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Core Orchestrator Wrapper

**Goal:** Create the wrapper around Claude SDK that intercepts responses and manages sessions.

**New files:**

```
src/agent/nextgen/orchestrator/
├── ClaudeAgentOrchestrator.ts    # Main wrapper around Claude SDK
├── ResponseInterceptor.ts        # Analyzes each response for actions
├── SessionManager.ts             # Manages resume, fork, parallel sessions
└── types.ts                      # Orchestrator types
```

**ClaudeAgentOrchestrator.ts:**
```typescript
class ClaudeAgentOrchestrator {
  private sdk: ClaudeAgentsSdk;
  private sessionManager: SessionManager;
  private interceptor: ResponseInterceptor;

  async run(task: string, options: OrchestratorOptions): Promise<OrchestratorResult> {
    const session = await this.sessionManager.createOrResume(options.sessionId);

    for await (const event of this.sdk.query({ prompt: task, ...session })) {
      // Intercept every response
      const action = await this.interceptor.analyze(event, session);

      switch (action.type) {
        case 'auto_continue':
          // Automatically respond without human input
          await this.sendContinuation(session, action.response);
          break;
        case 'fork_parallel':
          // Fork session to try multiple design approaches
          await this.forkForParallelExploration(session, action.designs);
          break;
        case 'compact':
          // Subtask complete - compact and extract learnings
          await this.compactAndLearn(session, action.subtask);
          break;
        case 'verification_failed':
          // Build/lint/test failed - send errors back to Claude
          await this.sendVerificationFailure(session, action.errors, action.summary);
          break;
        case 'review':
          // Ready to merge - trigger review stage
          await this.triggerReviewStage(session, action.branch);
          break;
        case 'forward':
          // Normal response - forward to user
          yield event;
          break;
      }
    }
  }
}
```

### Phase 2: Response Interceptor & Auto-Continue

**Goal:** Analyze Claude responses to detect continuation prompts and auto-respond when obvious.

**New file: `ResponseInterceptor.ts`**
```typescript
class ResponseInterceptor {
  private continueAnalyzer: ContinueAnalyzer;  // Uses Cerebras

  async analyze(event: SdkEvent, session: Session): Promise<InterceptAction> {
    if (event.type !== 'assistant') return { type: 'forward' };

    const text = event.content;

    // Pattern 1: "Should I continue implementing X?"
    if (this.detectsContinuationPrompt(text)) {
      const analysis = await this.continueAnalyzer.analyze(text, session.context);
      if (analysis.isObvious && analysis.confidence > 0.9) {
        return { type: 'auto_continue', response: analysis.response };
      }
    }

    // Pattern 2: "Here are two approaches: A) ... B) ..."
    if (this.detectsDesignProposal(text)) {
      const designs = this.extractDesigns(text);
      if (designs.length >= 2) {
        return { type: 'fork_parallel', designs };
      }
    }

    // Pattern 3: Subtask completion marker
    if (text.includes('<subtask_complete>') || this.detectsSubtaskDone(text)) {
      return { type: 'compact', subtask: this.extractSubtask(text) };
    }

    // Pattern 4: Ready to merge
    if (this.detectsReadyToMerge(text)) {
      return { type: 'review', branch: session.currentBranch };
    }

    return { type: 'forward' };
  }
}
```

**ContinueAnalyzer (Cerebras-powered):**
```typescript
class ContinueAnalyzer {
  private llm: LLM;  // Cerebras Qwen3 32b for speed

  async analyze(prompt: string, context: SessionContext): Promise<ContinueAnalysis> {
    // Fast analysis: Is this a yes/no question with obvious answer?
    const result = await this.llm.generateTextWithJson(
      [{ role: 'user', content: `
        Analyze this continuation prompt from a coding agent:
        "${prompt}"

        Context: ${context.currentTask}

        Is the answer obvious? If yes, what should the response be?
        Return: { isObvious: boolean, confidence: number, response: string, reasoning: string }
      `}],
      { schema: ContinueAnalysisSchema }
    );
    return result.object;
  }
}
```

### Phase 3: Parallel Fork Manager

**Goal:** Use `forkSession` to try multiple design approaches in parallel.

**New file: `ParallelForkManager.ts`**
```typescript
class ParallelForkManager {
  private sessionManager: SessionManager;

  async forkForDesigns(
    parentSession: Session,
    designs: DesignProposal[]
  ): Promise<ParallelForkResult> {
    // Create git worktrees for each design
    const worktrees = await this.createWorktrees(designs.length);

    // Fork SDK session for each design
    const forks = await Promise.all(designs.map(async (design, i) => {
      const forkedSession = await this.sessionManager.fork(parentSession.id, {
        additionalPrompt: `Implement design approach: ${design.description}`,
        cwd: worktrees[i].path,
      });
      return { design, session: forkedSession, worktree: worktrees[i] };
    }));

    // Run all forks in parallel
    const results = await Promise.all(forks.map(fork =>
      this.runForkToCompletion(fork)
    ));

    // Compare results and pick best (or ask user)
    return this.selectBestResult(results);
  }

  private async runForkToCompletion(fork: Fork): Promise<ForkResult> {
    // Run until subtask complete or error
    // Each fork works in its own worktree
  }
}
```

### Phase 4: Completion Verifier

**Goal:** Verify Claude's "I'm done" claims by running compile/lint/test before accepting completion.

**New file: `CompletionVerifier.ts`**
```typescript
class CompletionVerifier {
  private errorExtractor: ErrorExtractor;  // Cerebras Qwen3 32b for speed

  async verify(session: Session): Promise<VerificationResult> {
    // 1. Run build/compile
    const buildResult = await this.runBuild(session.cwd);
    if (!buildResult.success) {
      return this.handleFailure('build', buildResult.output, session);
    }

    // 2. Run linter
    const lintResult = await this.runLint(session.cwd);
    if (!lintResult.success) {
      return this.handleFailure('lint', lintResult.output, session);
    }

    // 3. Run unit tests
    const testResult = await this.runTests(session.cwd);
    if (!testResult.success) {
      return this.handleFailure('test', testResult.output, session);
    }

    // All passed - no output needed (context efficient)
    return { verified: true, passedStages: ['build', 'lint', 'test'] };
  }

  private async handleFailure(
    stage: 'build' | 'lint' | 'test',
    output: string,
    session: Session
  ): Promise<VerificationResult> {
    // Use Cerebras to extract relevant error details (reduces tokens)
    const extracted = await this.errorExtractor.extract(output, {
      stage,
      maxErrors: 10,
      includeContext: true,
    });

    return {
      verified: false,
      failedStage: stage,
      errors: extracted.errors,
      summary: extracted.summary,
      // Don't include full output - only extracted relevant parts
    };
  }

  private async runBuild(cwd: string): Promise<CommandResult> {
    // Detect build system and run appropriate command
    // npm run build, pnpm build, yarn build, make, etc.
  }

  private async runLint(cwd: string): Promise<CommandResult> {
    // npm run lint, eslint, etc.
  }

  private async runTests(cwd: string): Promise<CommandResult> {
    // npm test, jest, vitest, pytest, etc.
    // Only run unit tests (not integration/e2e for speed)
  }
}
```

**ErrorExtractor (Cerebras-powered):**
```typescript
class ErrorExtractor {
  private llm: LLM;  // Cerebras Qwen3 32b for speed

  async extract(output: string, options: ExtractOptions): Promise<ExtractedErrors> {
    // Fast extraction of relevant error information
    const result = await this.llm.generateTextWithJson(
      [{ role: 'user', content: `
        Extract the key errors from this ${options.stage} output.
        Return only the essential information needed to fix the issues.

        Output (truncated if >5000 chars):
        ${output.slice(0, 5000)}

        Return: {
          summary: string,  // 1-2 sentence summary
          errors: Array<{
            file?: string,
            line?: number,
            message: string,
            suggestion?: string
          }>,
          totalErrors: number
        }
      `}],
      { schema: ExtractedErrorsSchema }
    );
    return result.object;
  }
}
```

**Integration with ResponseInterceptor:**
```typescript
// In ResponseInterceptor.analyze()
// Pattern 4: "I'm done" claims - verify before accepting
if (this.detectsCompletionClaim(text)) {
  const verification = await this.completionVerifier.verify(session);
  if (!verification.verified) {
    // Send failure back to Claude to fix
    return {
      type: 'verification_failed',
      stage: verification.failedStage,
      errors: verification.errors,
      summary: verification.summary,
    };
  }
  // Verification passed - can proceed to forward completion
}
```

### Phase 5: Review Stage

**Goal:** Load guidelines + learnings, review branch diffs before merge.

**New file: `ReviewStage.ts`**
```typescript
class ReviewStage {
  private knowledgeBase: KnowledgeBase;
  private reviewAgent: ReviewAgent;  // Cerebras Qwen3 235b

  async review(branch: string, mainBranch: string): Promise<ReviewResult> {
    // 1. Get branch diffs
    const diffs = await this.gitDiff(mainBranch, branch);

    // 2. Load relevant guidelines from docs
    const guidelines = await this.loadGuidelines(diffs);

    // 3. Load relevant learnings from knowledge base
    const learnings = await this.knowledgeBase.retrieveRelevant(
      `Code review for: ${this.summarizeDiffs(diffs)}`
    );

    // 4. Run review agent (Cerebras for speed)
    const review = await this.reviewAgent.review({
      diffs,
      guidelines,
      learnings,
      checkpoints: [
        'code_style',
        'design_patterns',
        'error_handling',
        'test_coverage',
        'security',
      ],
    });

    // 5. Return review with approve/request_changes/block
    return {
      decision: review.decision,
      comments: review.comments,
      suggestions: review.suggestions,
      blockingIssues: review.blockingIssues,
    };
  }

  private async loadGuidelines(diffs: Diff[]): Promise<string[]> {
    // Search for relevant guidelines based on changed files
    // e.g., TypeScript files -> load typescript guidelines
    // e.g., API changes -> load API design guidelines
  }
}
```

### Phase 6: Integration with Existing NextGen

**Modify existing files:**

| File | Changes |
|------|---------|
| `src/agent/nextgen/core/agentRuntime.ts` | Add orchestrator integration option |
| `src/agent/nextgen/context/compactionService.ts` | Export for orchestrator use |
| `src/agent/nextgen/learning/learningExtractor.ts` | Export for orchestrator use |
| `src/agent/nextgen/learning/knowledgeBase.ts` | Export for review stage |

**New Cerebras sub-agents:**

| Sub-Agent | LLM | Purpose |
|-----------|-----|---------|
| ContinueAnalyzer | Qwen3 32b | Fast analysis of continuation prompts |
| ErrorExtractor | Qwen3 32b | Extract key errors from build/lint/test output |
| ReviewAgent | Qwen3 235b | Deep code review with guidelines |
| SearchAgent | Qwen3 32b | Fast code search (forked sessions) |
| DesignComparer | Qwen3 235b | Compare parallel design implementations |

### Phase 7: CLI & Testing

**New CLI command:**
```typescript
// ai orchestrate <task> --resume <sessionId>
program
  .command('orchestrate <task>')
  .option('--resume <sessionId>', 'Resume existing session')
  .option('--auto-continue', 'Enable auto-continuation (default: true)')
  .option('--parallel-designs', 'Fork for parallel design exploration')
  .option('--review-before-merge', 'Require review before merge (default: true)')
  .action(async (task, opts) => {
    const orchestrator = new ClaudeAgentOrchestrator();
    await orchestrator.run(task, opts);
  });
```

**Tests:**

```
src/agent/nextgen/orchestrator/__tests__/
├── ClaudeAgentOrchestrator.test.ts
├── ResponseInterceptor.test.ts
├── ContinueAnalyzer.test.ts
├── CompletionVerifier.test.ts
├── ErrorExtractor.test.ts
├── ParallelForkManager.test.ts
└── ReviewStage.test.ts
```

## Key Design Decisions

### 1. Wrapper Pattern (Not Replacement)

**Rationale:** Claude SDK does the heavy lifting for coding. Our orchestrator adds autonomous capabilities (auto-continue, parallel exploration, review) without reimplementing the core agent loop.

### 2. Response Interception

**Rationale:** Every Claude response is analyzed to detect actionable patterns. This enables autonomous behavior without modifying the SDK itself.

### 3. Fork-Based Parallel Exploration

**Rationale:** `forkSession` + git worktrees allow trying multiple design approaches simultaneously. Compare results and pick best, or ask user if unclear.

### 4. Cerebras for Meta-Operations

**Rationale:** Claude does the coding. Cerebras handles the orchestration decisions (analyze continuation prompts, review code, compare designs). This keeps Claude focused on the primary task.

### 5. Review Gate Before Merge

**Rationale:** Load all relevant guidelines and learnings for comprehensive review. Prevents merging code that violates project conventions or known pitfalls.

## Critical Files Reference

**Existing files to reuse:**
- `src/agent/nextgen/context/compactionService.ts` - Compact after subtask completion
- `src/agent/nextgen/learning/learningExtractor.ts` - Extract learnings on compaction
- `src/agent/nextgen/learning/knowledgeBase.ts` - Store/retrieve learnings for review
- `src/llm/services/cerebras.ts` - Fast LLMs for meta-operations

**New files to create:**
- `src/agent/nextgen/orchestrator/ClaudeAgentOrchestrator.ts` - Main wrapper
- `src/agent/nextgen/orchestrator/ResponseInterceptor.ts` - Response analysis
- `src/agent/nextgen/orchestrator/SessionManager.ts` - Resume/fork management
- `src/agent/nextgen/orchestrator/ParallelForkManager.ts` - Parallel exploration
- `src/agent/nextgen/orchestrator/CompletionVerifier.ts` - Build/lint/test verification
- `src/agent/nextgen/orchestrator/ReviewStage.ts` - Pre-merge review
- `src/agent/nextgen/orchestrator/analyzers/ContinueAnalyzer.ts` - Auto-continue logic
- `src/agent/nextgen/orchestrator/analyzers/ErrorExtractor.ts` - Extract errors from output

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| SDK API changes | Wrapper isolates SDK-specific code |
| Auto-continue errors | High confidence threshold (0.9+), fallback to human |
| Parallel fork divergence | Git worktrees ensure clean isolation |
| Review false positives | Human can override review decision |
| Cerebras rate limits | Use existing `CerebrasFallback` pattern |
| False completion claims | CompletionVerifier runs build/lint/test before accepting |
| Large test/build output | ErrorExtractor reduces output to essential errors only |

## Success Metrics

1. **Reduced interruptions**: Auto-continue handles >80% of obvious continuations
2. **Design quality**: Parallel exploration produces better designs
3. **Code quality**: Review stage catches issues before merge
4. **Learning retention**: Knowledge base improves reviews over time
5. **Long-running autonomy**: Complete multi-hour tasks without losing focus

## First Implementation Steps

1. Install `@anthropic-ai/claude-code` package (Claude Agent SDK)
2. Create `ClaudeAgentOrchestrator` with basic response forwarding
3. Add `ResponseInterceptor` with continuation and completion detection
4. Implement `ContinueAnalyzer` using Cerebras Qwen3 32b
5. Implement `CompletionVerifier` with build/lint/test commands
6. Implement `ErrorExtractor` to reduce output tokens
7. Test auto-continue and completion verification on sample prompts
8. Add `SessionManager` with fork support
9. Implement `ReviewStage` with guidelines + learnings loading
10. Add `ParallelForkManager` for design exploration
11. Integrate with existing compaction and learning extraction
