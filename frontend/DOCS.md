Fuse built around the idea of multi-purpose and multi-layout. You can think of Fuse as a Starter kit and a guide rather than just a simple template. The purpose of Fuse is not only provide a pre-made styles for visual elements but is also be a guide to follow while building an app.

It's more of an answer to the questions like Where should I put this file? or Which file should I put this piece of code into? rather than just a compilation of example pages and ready to use styles.

Here's a simplified version of the entire directory structure of the Fuse:

public
src/
@fuse/
app/
styles/
├─
index.html
└─
main.ts
/public
Default folder for static assets like images, fonts, static styles and etc.

/src/@fuse/
This is the core directory of the Fuse. It includes components, directives, services, pipes, custom validators, animations, base styles and much more.

Modifications on this directory is NOT recommended. Since majority of changes happen within this directory on updates, any modifications to this directory and its content will make the updating process complex and time consuming.

src/app/
This directory contains all application related codes. This is where you put your code.

Fuse provides a sensible default directory structure within the app directory. You can of course completely remove everything from it and design your own structure but the provided structure is designed to handle applications from small to enterprise grade:

app/
core/
layout/
mock-api/
modules/
├─
app.component.html
├─
app.component.scss
├─
app.component.ts
├─
app.config.ts
├─
app.resolvers.ts
└─
app.routes.ts
src/app/core/
This directory is designed to contain your application's core; Singleton services, default configurations, default states and likes. It's NOT recommended to put any components, directives, pipes or simply anything has a template or related to templates in here.

Example files that can go into this directory includes, but not limited to:

Singleton services:

Auth service

Logger service

SplashScreen service

Guards

Auth guard

NoAuth guard

Defaults

Default configurations

Default state

Custom validators

Phone number validator

Confirm validator

and etc...

src/app/mock-api/
This directory is designed to contain data services for custom made MockAPI library. Detailed information about this directory and the MockAPI library can be found in the Fuse Components > Libraries > MockAPI section of this documentation.

src/app/layout/
This directory designed to contain everything related to the layout of your app. By default, Fuse provides variety of different layout options for you to use.

The LayoutComponent is an entry component and it provides an easy way of switching between different layouts. More information about how the LayoutComponent works can be found in the Customization > Theme layouts section of this documentation.

The app/layout/common/ folder includes common components for layouts such as:

Messages
Notifications
Search
Shortcuts
User Menu
These components are being used across different layouts, so if you use multiple layouts and want to create a component, directive or a pipe for using within your layouts, you can put them inside the common folder.

src/app/modules/
This directory is designed to contain your application's feature modules.

For example; Authentication related pages such as Sign In, Sign Up, Lost Password and etc. can be grouped into auth/ directory while your main admin components and modules grouped into admin/ directory.

If you use SSR (Server Side Rendering) you can even include your landing page as one of the modules and keep everything in a single app.

src/styles/
This folder contains 4 different scss files:

styles.scss

This file is for adding/importing global styles to the app.

tailwind.scss

This is the main Tailwind file for Tailwind utilities.

vendors.scss

This file is designed to import 3rd party library css/scss files into the project. Any style here can be overridden by styles.scss file allowing you to overwrite/modify 3rd party library styles and make them visually compatible with your app.

For example, let's say you use FullCalendar 3rd party library. You use the vendors.scss file to import default styles of the FullCalendar into your project so it looks and works correctly. Then, you can add custom styles to the styles.scss file to overwrite those default styles to make FullCalendar compatible with your app's design.


# Angular code conventions and style guide

All HTTP calls must be done through service objects.  Components with templates should not make direct HTTP calls.

Use the [matTooltip] binding, not the <mat-tooltip> component.

# Angular unit testing guidelines

1.  **Test Through Public APIs (The Rendered Template/DOM):**
    *   **Angular Application:** The *primary* public API of a component, from a user's perspective, is its **rendered template (DOM)**. Users interact with buttons, inputs, links, etc., and see displayed text or visual changes. `@Input()` properties and `@Output()` events are also part of the API, mainly relevant for parent-child interactions.
    *   **Action:** Configure the component using `TestBed`. Obtain the `ComponentFixture`. Interact with the component primarily by querying and manipulating its **DOM elements** using `fixture.nativeElement` or `fixture.debugElement.query(By.css(...))` / `queryAll(By.css(...))`. Simulate user events (e.g., `buttonElement.click()`, `inputElement.value = '...'; inputElement.dispatchEvent(new Event('input'))`). **Crucially, call `fixture.detectChanges()`** after setting inputs or simulating events that should cause the DOM to update.
    *   **Assertion:** Assert on the **state of the DOM** (e.g., `expect(element.textContent).toContain(...)`, `expect(button.disabled).toBeTrue()`, `expect(query(By.css('.error-message'))).not.toBeNull()`).

2.  **Prioritize State Testing (DOM State) over Interaction Testing (Internal Methods):**
    *   **Angular Application:** Verify the *user-visible outcome* in the DOM after an action.
    *   **Action:** After triggering an event and `detectChanges()`, check if the expected text is displayed, elements are added/removed, styles/classes are applied correctly, or inputs/buttons are enabled/disabled as expected in the DOM.
    *   **Avoid:** Primarily spying on and verifying calls to the component's *internal, private helper methods* (`spyOn(component, 'internalHelper'); ... expect(component.internalHelper).toHaveBeenCalled()`). Focus on the end result visible to the user.
    *   **Acceptable Interaction Testing:**
        *   Verifying `@Output()` event emissions (`spyOn(component.myOutput, 'emit'); button.click(); fixture.detectChanges(); expect(component.myOutput.emit).toHaveBeenCalledWith(expectedPayload);`), as this is part of the component's external contract *to its parent*.
        *   Verifying calls to *mocked/faked service methods* (`expect(mockUserService.save).toHaveBeenCalledWith(...)`) when the service call is a key side effect of the user interaction and not fully verifiable via DOM state alone.

3.  **Focus on Behaviors (User Scenarios), Not Just Methods:**
    *   **Angular Application:** Structure `describe` and `it` blocks around user-centric scenarios.
    *   **Examples:** `it('should display an error message when submitting an empty form')`, `it('should populate the list when data is received')`, `it('should disable the save button until the form is valid')`, `it('should emit the item id when delete icon is clicked')`.

4.  **Strive for Maximum Clarity and Readability (Angular Context):**
    *   **Structure (`TestBed`, `fixture`, `detectChanges`):** Use `beforeEach(async(() => { TestBed.configureTestingModule({...}).compileComponents(); }));` or equivalent async setup. Inside `it`:
        *   *Arrange:* Get `fixture = TestBed.createComponent(...)`, `component = fixture.componentInstance`, set `@Input`s (`component.input = ...`), query initial elements. Call initial `fixture.detectChanges()`.
        *   *Act:* Simulate user events (`element.click()`), update component properties if necessary, call `fixture.detectChanges()`. Use `async/await`, `fakeAsync/tick`, or `whenStable` to handle asynchronous operations within the component or test.
        *   *Assert:* Query the DOM again and use `expect` assertions on element properties or content.
    *   **Completeness/Conciseness (DAMP):** `TestBed` setup often involves declaring the component under test, providing mocks/fakes for dependencies (services, pipes, directives), and potentially handling child components (see below). Keep the `beforeEach` setup common and minimal. Override providers or configure specific mock behavior *within* an `it` block if it clarifies that specific test scenario. Helper functions for common interactions (e.g., `login(fixture, user, pass)`) can be useful but shouldn't hide the core interaction being tested.
    *   **No Logic in Tests:** Still crucial. `it` blocks should be sequences of interactions and assertions.
    *   **Clear Failures:** Standard matchers work well. Failures often arise from incorrect DOM queries (element not found) or unexpected DOM state after `detectChanges()`.

5.  **Strong Preference: Use Real Implementations (Carefully Applied):**
    *   **Component Class:** Always use the real component class itself via `TestBed.createComponent`.
    *   **Child Components:**
        *   *Deep Testing:* Including real child components can test integration but makes tests more complex and brittle. Do this only if the child is simple, stable, and integral to the parent's function.
        *   *Shallow Testing (Preferred):* Isolate the component. Use `NO_ERRORS_SCHEMA` in `TestBed` to ignore unknown elements (child components) or declare simple stub components (`@Component({selector: 'app-child', template: ''}) class StubChildComponent {}`) in the `declarations`.
    *   **Services/Pipes/Directives:** Apply the original principle: Use the real implementation *only if* it's fast, deterministic, and hermetic (no external dependencies like HTTP). Most services (especially those involving HTTP) should *not* be the real ones. Simple, pure pipes or attribute directives might be okay to include directly.

6.  **When Real Won't Work: Use Test Doubles Strategically:**
    *   **Preference Order:**
        1.  **Real (where applicable):** See #5.
        2.  **Fakes (for Services):** *Strongly preferred* for dependencies like services. Create a fake class implementing the service interface (`class FakeUserService implements IUserService { ... }`) and provide it in `TestBed`: `{ provide: UserService, useClass: FakeUserService }`. The fake can return controlled data (e.g., `Observable<User[]>` via `of([...])`).
        3.  **Stubs/Spies (Jasmine Spies / Sinon / Mocks):** Provide mock objects or use spies for services if a full fake isn't needed: `const userServiceSpy = jasmine.createSpyObj('UserService', ['getUsers', 'saveUser']); userServiceSpy.getUsers.and.returnValue(of(mockUsers)); ... { provide: UserService, useValue: userServiceSpy }`. Use `spyOn(serviceInstance, 'method').and.returnValue(...)` if dealing with instances. Use primarily to control return values needed for the test.
        4.  **Stub Components/Directives:** As mentioned in #5, use stub components or `NO_ERRORS_SCHEMA` to isolate the component under test from its children or complex directives.

7.  **Enable Testability via Design (Angular DI):**
    *   Angular's constructor injection makes this straightforward. Ensure components declare dependencies in their constructor, typed with interfaces where possible. `TestBed` handles providing the real or mock/fake dependency.

8.  **Prefer DAMP over DRY (TestBed Setup):**
    *   `TestBed.configureTestingModule` can become repetitive. Extract common declarations/providers/imports into a shared `beforeEach` setup function *within the `describe` block*. However, if a specific test needs a unique provider setup (e.g., a service mock returning an error), define that specific provider override *within the `it` block's `TestBed` configuration* or just before component creation, rather than adding complexity/logic to the shared `beforeEach`. Clarity for the specific test scenario trumps absolute DRYness in `TestBed` config.
