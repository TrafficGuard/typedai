## CePO vs Multi-Agent Debate (MAD): When to Use Which

### Architecture Overview

| | CePO | MAD (ReasonerDebateLLM) |
|---|---|---|
| **Core approach** | Single model self-reflects across multiple solution paths | Multiple models debate and synthesize perspectives |
| **Parallelism** | Multiple plans from same model | Multiple models generate simultaneously |
| **Refinement** | Self-consistency checking | Cross-pollination of ideas between models |
| **Final synthesis** | Same model consolidates | Mediator model synthesizes |

---

### LLM Call Counts

**CePO with SOTA config** (`bestofn_n=1`, `rating_type='none'`):
```
Step 1: Plan generation    × 2 (planning_n)
Step 2: Execute plan       × 2
Step 3: Refine             × 1
Step 4: Final answer       × 1
────────────────────────────────────
Total: ~6 calls (single model)
```

**CePO with gpt-oss config** (`bestofn_n=3`, `rating_type='absolute'`):
```
Completions: 3 × 6 calls  = 18
Rating:      3 calls
────────────────────────────────────
Total: ~21 calls
```

**MAD** (3 agents):
```
thinking='high'   (3 rounds): 3 + 3×3 + 1 = 13 calls
thinking='medium' (2 rounds): 3 + 3×2 + 1 = 10 calls
thinking='low'    (1 round):  3 + 3×1 + 1 =  7 calls
```

**MAD** (4 agents):
```
thinking='high':   17 calls
thinking='medium': 13 calls
thinking='low':     9 calls
```

---

### When to Use CePO

**Best for:**
- **Structured outputs** (JSON, code, specific formats)
- **Problems with verifiable correctness** (deterministic tasks, logic)
- **Cost-sensitive SOTA usage** (6 calls vs 10+)
- **When you trust a single model's self-reflection** (strong reasoning models like o3, Gemini 2.5 Pro, Claude Opus)

**Why it works:**
CePO's plan → execute → verify flow naturally fits structured problem-solving. The model generates multiple approaches, checks its own work for inconsistencies, and consolidates. Strong reasoning models are good at catching their own mistakes through self-reflection.

---

### When to Use MAD

**Best for:**
- **Open-ended reasoning** where multiple perspectives genuinely help
- **High-stakes decisions** where model diversity provides a safety net
- **Subjective or ambiguous tasks** where "best answer" isn't objectively clear
- **When hedging against single-model blind spots** (each model family has different failure modes)

**Why it works:**
Different models (Claude, Gemini, GPT, Grok) have different training data, architectures, and biases. MAD leverages this diversity—if one model misses something, another might catch it. The debate rounds force models to engage with alternative perspectives rather than just doubling down on their initial approach.

---

### Decision Framework

```
Is the output structured (JSON, code, specific format)?
  └─ Yes → CePO

Is there an objectively correct answer?
  └─ Yes → CePO (self-verification works well)
  └─ No/Subjective → MAD (multiple perspectives help)

Are you cost-constrained with SOTA models?
  └─ Yes → CePO SOTA config (6 calls)
  └─ No → MAD or CePO gpt-oss depending on task type

Do you want to hedge against model-specific blind spots?
  └─ Yes → MAD with diverse models (e.g., MAD_Balanced)
  └─ No → CePO

Using fast/cheap models (Cerebras gpt-oss)?
  └─ Yes → CePO gpt-oss config (can afford more calls)
```

---

### Practical Examples

| Task | Recommendation | Why |
|------|----------------|-----|
| Generate JSON of files to load | CePO | Structured output, verifiable |
| Complex math problem | CePO | Objectively correct answer |
| Code refactoring | CePO | Deterministic, can self-verify |
| Strategic business advice | MAD | Subjective, benefits from perspectives |
| Ambiguous requirements analysis | MAD | No single "right" answer |
| Creative writing direction | MAD | Subjective quality |
| Debugging subtle logic error | MAD | Different models spot different issues |
| High-stakes legal/medical reasoning | MAD | Want diversity as safety net |

---

### Hybrid Consideration

For your most critical tasks, you could potentially chain them: use MAD to get diverse initial perspectives, then feed the synthesized result into CePO for structured refinement. But this is likely overkill for most use cases—pick one based on the task characteristics above.