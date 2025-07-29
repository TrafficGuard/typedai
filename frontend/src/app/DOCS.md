**Core Principles for All Unit Tests:**

1.  **Test Through Public APIs (Simulate the User):**
    *   **Action:** Interact with the System Under Test (SUT) *only* through its `export`-ed interface (classes, functions, methods, etc.), exactly as an external consumer or user of that module/code would.
    *   **Avoid:** Calling private methods (often indicated by `_` prefix convention or `#` private fields), accessing private properties, or relying on implementation-specific details (like internal data structures or intermediate variables).
    *   **Rationale:** Tests coupled to implementation details are brittle. Refactoring the SUT's internals (without changing its public contract) should *not* break tests. Testing the public API ensures you're validating the actual contract the SUT provides to its users. Define the "unit" scope appropriately – it might be a single exported class or function, or sometimes a small cluster of closely related components acting as one logical unit.

2.  **Prioritize State Testing over Interaction Testing:**
    *   **Action:** Verify the *outcome* of an action using assertions. Check the SUT's final state (e.g., values of public properties, data returned from methods) or the return value of the method being tested. Use assertions like `expect(actual).to.equal(expected)`, `expect(array).to.deep.equal([...])`, `expect(obj.property).to.be.true`.
    *   **Avoid:** Primarily relying on spies or stubs merely to verify method calls (`expect(spy).to.have.been.called`, `expect(stub).to.have.been.calledWith(...)`). This tests the *how* (implementation path) rather than the *what* (the actual result).
    *   **Rationale:** State testing focuses on the observable results and behavior, which is what users care about. Interaction tests are inherently brittle because they depend on the SUT's internal implementation strategy (e.g., which helper methods it calls). Refactoring internal collaborations often breaks interaction tests unnecessarily.

3.  **Focus on Behaviors, Not Just Methods:**
    *   **Action:** Structure tests using `describe` and `it` blocks to represent distinct *user behaviors* or scenarios. Think "Given [context], When [action], Then [outcome]". A single public method might encompass multiple behaviors (e.g., success path, error handling for invalid input, edge cases), each deserving its own focused `it(...)` block within a relevant `describe(...)` suite.
    *   **Rationale:** Method-oriented tests (`describe('MyClass.myMethod', ...)`) containing one large `it` block tend to grow complex and unclear as the method evolves. Behavior-focused tests are smaller, more targeted, easier to understand, and better document the SUT's capabilities and constraints.

4.  **Strive for Maximum Clarity and Readability:**
    *   **Descriptive Naming:** Use descriptive strings in `describe` and `it`. A common pattern: `describe('[ClassName/ModuleName]', () => { describe('#methodName / .propertyName', () => { it('should [expected outcome] when [condition/context]', () => { ... }); }); });`. The `it` string should make the test's purpose obvious even in the output report.
    *   **Clear Structure (Arrange/Act/Assert in `it` blocks):** Organize the code inside `it` blocks logically. Use whitespace (blank lines) or comments (`// Arrange`, `// Act`, `// Assert` or `// Given`, `// When`, `// Then`) to clearly separate setup, execution, and validation steps. Use `beforeEach` sparingly, primarily for simple, repetitive setup like instantiating the SUT with default dependencies, ensuring it doesn't hide crucial context for individual tests. Avoid interleaving actions and assertions excessively within a single logical block. Handle `async`/`await` correctly for asynchronous operations within tests.
    *   **Completeness & Conciseness (The DAMP Principle):** The body of an `it` block should contain all information *essential* to understanding that specific scenario without requiring the reader to jump to complex `beforeEach` hooks or constants defined far away. However, avoid cluttering the test with irrelevant setup details – use TypeScript helper functions or Builder pattern implementations for boilerplate *if* they don't obscure the key inputs/state relevant to *this specific test*.
    *   **No Logic in Tests:** `it` blocks should be straightforward and easily verifiable by eye. Avoid `if/else`, `for` loops, complex conditionals, `switch` statements, `try/catch` blocks (unless specifically testing error throwing using `expect(...).to.throw()`), or intricate computations. If you feel a test needs its own test, it's too complex. Prefer hardcoded, literal values for inputs and expected outputs within each `it` block.
    *   **Clear Failure Messages:** Leverage the test library's expressive, chainable assertion syntax.  Produce highly informative messages upon failure (e.g., `expected 'actual' to equal 'expected'`), making diagnosis fast without needing to debug the test code itself. Add custom messages (`expect(value, 'custom message').to.equal(true);`) only if the default message isn't sufficiently clear for a specific complex assertion.

**Guidance on Using Test Doubles (Fakes, Stubs, Mocks):**

5.  **Strong Preference: Use Real Implementations:**
    *   **Action:** Whenever feasible, `import` and use the *actual*, production TypeScript classes/functions/modules that are dependencies of the SUT.
    *   **Conditions:** This is appropriate *only if* the real dependency is:
        *   **Fast:** Doesn't significantly slow down the test suite execution .
        *   **Deterministic:** Always produces the same result given the same input, with no randomness or external variance.
        *   **Hermetic (No Side Effects):** Doesn't rely on or affect external systems (network APIs, filesystem, real database, `Date.now()`, etc.).
        *   **Simple to Construct/Manage:** Doesn't require complex multi-step setup itself within the test.
    *   **Rationale:** Using real implementations provides the highest fidelity and confidence, testing the actual integration points as they will run in production. Avoids duplicating or poorly simulating dependency logic.

6.  **When Real Won't Work: Use Test Doubles Strategically:**
    *   **Decision:** Use a test double only when a real dependency violates the conditions above (slow, non-deterministic, side effects, complex setup).
    *   **Clear Preference Order for Doubles:**
        1.  **Fakes:** *Strongly preferred*. These are lightweight, working TypeScript implementations of the dependency's `interface` or `class` contract designed specifically for testing (e.g., `class InMemoryUserRepository implements IUserRepository`). They maintain state and logic, behaving realistically from the SUT's perspective, but are simpler and faster than the real thing. *If a well-maintained Fake exists (often provided alongside the real implementation), use it.* Ideally, fakes are tested themselves against the contract.
        2.  **Stubs:**  *Dangers:* Over-stubbing makes tests brittle (tied to implementation), unclear (replicates dependency logic poorly), and doesn't verify the stubbed behavior matches reality. Avoid complex chains of stubs. Each stub should ideally relate directly to the test's assertions.
        3.  **Interaction Testing / Mocks (Stubs/Spies):** *Avoid this whenever possible*. Use assertions like `expect(stub).to.have.been.calledOnce`, `expect(stub).to.have.been.calledWith(arg1, arg2)` (adjusted for the test framework/utils available) *only* as a last resort when state testing is truly impossible.
            *   *Valid (Rare) Use Cases:* Verifying calls to external systems where there's no observable state change (e.g., logging to console, sending an email *if* you can't check an inbox), or validating performance optimizations (e.g., ensuring a cache prevents extra calls).
            *   *Focus:* If verifying, focus on *state-changing* methods (e.g., `saveUser`, `sendNotification`), not simple read/query methods (e.g., `getUserById`) whose results influence testable state anyway.
            *   *Avoid Overspecification:* Verify only the *essential* part of the interaction for *this specific behavior*. Don't verify every argument or every incidental call if it's not core to the behavior being tested.

7.  **Enable Testability via Design (Dependency Injection):**
    *   **Action:** Design TypeScript classes so their dependencies are *injected* (typically passed into the `constructor`) rather than being created internally (`this.service = new ConcreteService();`). Use interfaces (`interface IDependency`) as the type hints for dependencies.
    *   **Rationale:** This creates "seams" allowing tests (in `beforeEach` or `it`) to easily provide either the real dependency or a test double (Fake, stub) without changing the SUT's code. Consider lightweight DI containers if managing dependencies becomes complex, but often manual injection is sufficient for unit tests.

**Code Sharing Principles:**

8.  **Prefer DAMP (Descriptive And Meaningful Phrases) over DRY (Don't Repeat Yourself):**
    *   **Action:** Tolerate *some* duplication within or across `it` blocks if it significantly improves clarity and makes each test self-contained and easier to understand in isolation.
    *   **Avoid:** Creating complex, logic-filled helper functions or overly generic `beforeEach` setup / shared validation functions just to eliminate repetition, if doing so obscures the specific inputs, actions, or expected outputs relevant to individual tests.
    *   **Good Sharing:** Use simple TypeScript helper functions for creating test data objects with sensible defaults (e.g., factory functions or builders). Basic `beforeEach` hooks are acceptable for instantiating the SUT with default dependencies if that setup is truly common and simple.
    *   **Bad Sharing:** Helpers that contain conditional logic, multiple steps of interaction with the SUT, or highly generic validation routines that make it hard to see what a specific `it` block is actually testing.





# ANGULAR PAGE-OBJECT & SPEC GUIDELINES

## FILES & NAMING

1. The component lives in `src/app/…/foo.component.{ts,html,scss}`.  
   Its PO lives right next to it as `foo.component.po.ts`.  
   The spec lives next to the component as `foo.component.spec.ts`.

2. In tests always import the *stand-alone* component, never its module:
   ```ts
   imports: [FooComponent, NoopAnimationsModule]
   ```

3. Use the same “selector-like” name for PO and spec –  
   `FooComponent`, `FooPo`, `FooComponentSpec`.

## PAGE-OBJECT CONVENTIONS

1. **Inheritance**  
   Every PO extends `BaseSpecPo<TComponent>`; no 3-rd level hierarchy.

2. **Static factory**  
   Provide exactly one factory:
   ```ts
   static async create(fix: ComponentFixture<T>): Promise<FooPo> {
       const po = new FooPo(fix);
       await po.detectAndWait();
       return po;
   }
   ```
   Additional factories are forbidden.

3. **IDs & locators**  
   • Components expose **only data-testids** (`data-testid="send-btn"`).  
   • The PO keeps them in a single `private readonly ids = { … }` map.  
   • NO deep CSS selectors, NO `By.css('*')`, NO positional selectors
     (`:nth-child`).  
   • If the template needs a new locator → add a test-id in the component first.

4. **Harness first**  
   Prefer Angular-Material Harnesses; fallback to DebugElement only when the
   target element has no harness.

5. **API structure**
   ```
   // 5 lines max comment, written in “business language”
   class FooPo {
       /* ── state (getters with NO side-effects) ─────────────────── */
       isLoading(): boolean { … }
       commentCount(): number { … }

       /* ── user actions (return Promise<void>) ───────────────────── */
       async typeMessage(txt: string): Promise<void> { … }
       async send(): Promise<void> { … }
   }
   ```

6. **Self-synchronising**  
   Every action internally calls `await this.detectAndWait();` after it clicks,
   types or selects something.  Specs never call `fixture.detectChanges()`.

7. **NO assertions**  
   The PO *exposes* behaviour; the spec *asserts* on it.

8. **No test-double knowledge**  
   The PO never references spies or fake services – that belongs to the spec.

## SPEC CONVENTIONS

1. **Given / When / Then**  
   Group phases with blank lines:
   ```ts
   // Given
   chat.setChat(emptyChat());
   await po.waitUntilReady();

   // When
   await po.typeMessage('hello');
   await po.send();

   // Then
   expect(po.inputValue()).toBe('');
   expect(chat.sendMessage).toHaveBeenCalled();
   ```

2. **Avoid fakeAsync unless you test timers** – harnesses wait automatically.

3. Each `it()` covers **one observable user-story**; never mix scenarios.

4. Use `spyOn(svc, 'method').and.callThrough()` to keep behaviour + verify calls.

## ASYNC & WAITING RULES

1. All PO actions are `await`-ed in specs; never ignore returned Promises.

2. Harness queries use `await TestbedHarnessEnvironment.loader(fix).getHarness(...)` – they already wait for Angular stabilisation & animations.

3. For custom polling use:
   ```ts
   await waitFor(() => expect(po.isLoading()).toBeFalse());
   ```
   (`waitFor` = our small wrapper around `fakeAsync`+`tick`).

## MAINTENANCE & STYLE

1. **Single-responsibility**  
   If a PO exceeds ≈250 LOC or the component splits, create smaller POs.

2. **Strict Type-Script** (`"strict": true`) – no implicit `any`, no `as unknown`.

3. **No global test state** – each `beforeEach` creates new fakes & fixtures.

4. **Readable failure messages** – always assert with an explicit message when
   failure can be ambiguous:
   ```ts
   expect(po.commentCount())
       .withContext('Comment not rendered after Send')
       .toBe(1);
   ```

5. **Keep it deterministic** – no `setTimeout` in specs; use harness or zone
   helpers.

## COMMON PATTERNS

1. ***Typing & send in one helper***  
   ```ts
   async sendMessage(txt: string) {
       await this.typeMessage(txt);
       await this.clickSend();
   }
   ```
   Use this across specs to reduce duplication.

2. ***Counting items*** – add a test-id on the repeated element and query
   directly:
   ```html
   <li data-testid="msg" …></li>
   ```
   ```ts
   messageCount() {
       return this.fix.debugElement.queryAll(By.css('[data-testid="msg"]')).length;
   }
   ```

3. ***Drawer / Overlay***  
   Query by role or `aria-label`, then check `classList.contains('mat-drawer-opened')`.

## EXAMPLE SKELETON

```ts
// foo.component.po.ts
export class FooPo extends BaseSpecPo<FooComponent> {
    private ids = {
        input : 'msg-input',
        send  : 'send-btn',
        msg   : 'msg',
        spin  : 'spinner',
    } as const;

    /* ---------- state ---------- */
    inputValue()         { return this.value(this.ids.input); }
    messageCount()       { return this.count(this.ids.msg);  }
    isGenerating()       { return this.has(this.ids.spin);   }

    /* ---------- actions -------- */
    async typeMessage(t: string) {
        await this.setValue(this.ids.input, t);
    }
    async clickSend()    { await this.click(this.ids.send);  }
    async send(t: string){ await this.typeMessage(t); await this.clickSend(); }
}
```

```ts
// foo.component.spec.ts
describe('FooComponent', () => {
  let po: FooPo;
  let chat: FakeChatSvc;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports  : [FooComponent, NoopAnimationsModule],
      providers: [{ provide: ChatServiceClient, useClass: FakeChatSvc }]
    }).compileComponents();

    chat = TestBed.inject(ChatServiceClient) as any;
    spyOn(chat, 'sendMessage').and.callThrough();

    po = await FooPo.create(TestBed.createComponent(FooComponent));
  });

  it('clears input and shows generating after send', async () => {
    chat.setChat(emptyChat());
    await po.send('hello');

    expect(po.inputValue()).toBe('');
    expect(po.messageCount()).toBe(1);
    expect(po.isGenerating()).toBeTrue();
  });
});
```

## FOLLOW THE CHECK-LIST BEFORE EVERY PR

☐ File names & location ok   ☐ All locators = test-ids  
☐ PO contains **only** queries + actions   ☐ No `detectChanges` in spec  
☐ No deep CSS selectors   ☐ Harness preferred   ☐ Type-strict  
☐ Each test covers one scenario   ☐ No left-over console.logs/xtests

If something forces you to deviate, highlight it in the PR description with a short rationale.

# Icons

In tests use MatIconTestingModule