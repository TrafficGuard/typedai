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




# How I Learned To Stop Writing Brittle Tests and Love Expressive APIs

A valuable but challenging property for tests is “resilience,” meaning a test should only fail when something important has gone wrong. However, an opposite property may be easier to see: A “brittle” test is one that fails not for real problems that would break in production, but because the test itself is fragile for innocuous reasons. Error messages, changing the order of metadata headers in a web request, or the order of calls to a heavily-mocked dependency can often cause a brittle test to fail.

Expressive test APIs are a powerful tool in the fight against brittle, implementation-detail heavy tests. A test written with IsSquare(output) is more expressive (and less brittle) than a test written with details such as JsonEquals(.width = 42, .length = 42), in cases where the size of the square is irrelevant. Similar expressive designs might include unordered element matching for hash containers, metadata comparisons for photos, and activity logs in processing objects, just to name a few.

As an example, consider this C++ test code:
```
absl::flat_hash_set<int> GetValuesFromConfig(const Config&);


TEST(ConfigValues, DefaultConfigsArePrime) {

// Note the strange order of these values. BAD CODE, DON’T DO THIS!

EXPECT_THAT(GetValuesFromConfig(Config()), ElementsAre(29, 17, 31));

}
```

The reliance on hash ordering makes this test brittle, preventing improvements to the API being tested. A critical part of the fix to the above code was to provide better test APIs that allowed engineers to more effectively express the properties that mattered. Thus we added UnorderedElementsAre to the GoogleTest test framework and refactored brittle tests to use that:
```
TEST(ConfigValues, DefaultConfigsArePrimeAndOrderDoesNotMatter) {

EXPECT_THAT(GetValuesFromConfig(Config()), UnorderedElementsAre(17, 29, 31));

}
```
It’s easy to see brittle tests and think, “Whoever wrote this did the wrong thing! Why are these tests so bad?” But it’s far better to see that these brittle failures are a signal indicating where the available testing APIs are missing, under-advertised, or need attention.

Brittleness may indicate that the original test author didn’t have access to (or didn’t know about) test APIs that could more effectively identify the salient properties that the test meant to enforce. Without the right tools, it’s too easy to write tests that depend on irrelevant details, making those tests brittle. 


# Test failures should be actionable

There are a lot of rules and best practices around unit testing. There are many posts on this blog; there is deeper material in the Software Engineering at Google book; there is specific guidance for every major language; there is guidance on test frameworks, test naming, and dozens of other test-related topics. Isn’t this excessive?

Good unit tests contain several important properties, but you could focus on a key principle: Test failures should be actionable.

When a test fails, you should be able to begin investigation with nothing more than the test’s name and its failure messages—no need to add more information and rerun the test.

Effective use of unit test frameworks and assertion libraries (JUnit, Truth, pytest, GoogleTest, etc.) serves two important purposes. Firstly, the more precisely we express the invariants we are testing, the more informative and less brittle our tests will be. Secondly, when those invariants don’t hold and the tests fail, the failure info should be immediately actionable. This meshes well with Site Reliability Engineering guidance on alerting.

Consider this example of a C++ unit test of a function returning an `absl::Status` (an Abseil type that returns either an “OK” status or one of a number of different error codes):

## Bad example
```
EXPECT_TRUE(LoadMetadata().ok());

// Failure output
load_metadata_test.cc:42: Failure
Value of: LoadMetadata().ok()
Expected: true
Actual: false
```

## Good example

```
EXPECT_OK(LoadMetadata());

// Failure output
load_metadata_test.cc:42: Failure
Value of: LoadMetadata()
Expected: is OK
Actual: NOT_FOUND: /path/to/metadata.bin
```

If the first bad example test fails, you have to investigate why the test failed; 
The second good test immediately gives you all the available detail, in this case because of a more precise GoogleTest matcher.


# Prefer Narrow Assertions in Unit Tests

Your project is adding a loyalty promotion feature, so you add a new column CREATION_DATE to the ACCOUNT table. Suddenly the test below starts failing. Can you spot the problem?
```
TEST_F(AccountTest, UpdatesBalanceAfterWithdrawal) {

ASSERT_OK_AND_ASSIGN(Account account,

                       database.CreateNewAccount(/*initial_balance=*/5000));

ASSERT_OK(account.Withdraw(3000));

const Account kExpected = { .balance = 2000, /* a handful of other fields */ };

EXPECT_EQ(account, kExpected);

}
```

You forgot to update the test for the newly added column; but the test also has an underlying problem:

It checks for full equality of a potentially complex object, and thus implicitly tests unrelated behaviors. Changing anything in Account, such as adding or removing a field, will cause all the tests with a similar pattern to fail. Broad assertions are an easy way to accidentally create brittle tests  - tests that fail when anything about the system changes, and need frequent fixing even though they aren't finding real bugs.

Instead, the test should use narrow assertions that only check the relevant behavior. The example test should be updated to only check the relevant field account.balance:
```
TEST_F(AccountTest, UpdatesBalanceAfterWithdrawal) {

ASSERT_OK_AND_ASSIGN(Account account,

                       database.CreateNewAccount(/*initial_balance=*/5000));

ASSERT_OK(account.Withdraw(3000));

EXPECT_EQ(account.balance, 2000);

}
```
Broad assertions should only be used for unit tests that care about all of the implicitly tested behaviors, which should be a small minority of unit tests. Prefer to have at most one such test that checks for full equality of a complex object for the common case, and use narrow assertions for all other cases.

Similarly, when writing frontend unit tests, use one screenshot diff test to verify the layout of your UI, but test individual behaviors with narrow DOM assertions.

For testing large protocol buffers, some languages provide libraries for verifying a subset of proto fields in a single assertion, such as:

`.comparingExpectedFieldsOnly()` in Java (Truth Protobuf Extension)

`protocmp.FilterField` in Go (protocmp)



# Page Objects

```typescript
    async openDrawer() {
        await this.click(this.ids.openInfo);
    }

    async openChatInfo(): Promise<ChatInfoPo> {
        await this.openDrawer();
        await this.detectAndWait();
        return ChatInfoPo.create(this.fix as any);
    }
```

```typescript
    async openDrawer() {
        await this.click(this.ids.openInfo);
        await this.detectAndWait();
    }

    async openChatInfo(): Promise<ChatInfoPo> {
        await this.openDrawer();
        return ChatInfoPo.create(this.fix as any);
    }
```
<!-- Explain why second version is better -->

# Icons

In tests use MatIconTestingModule