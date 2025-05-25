# API schemas

Angular services should always use RouteDefinitions from the shared/api folder when calling server routes.

## Model/schema types

Don't convert a TypeBox schema to a plain interface with `import type { Static } from '@sinclair/typebox';` This is incorrect.

The correct style is to important a plain interface that represents the schema.


# Angular Signals

You should use signals instead of @Input/@Ouput and observables where possible.

A **signal** is a wrapper around a value that notifies interested consumers when that value changes. Signals can contain any value, from primitives to complex data structures.

You read a signal's value by calling its getter function, which allows Angular to track where the signal is used.

Signals may be either _writable_ or _read-only_.

### Writable signals

Writable signals provide an API for updating their values directly. You create writable signals by calling the `signal` function with the signal's initial value:

```typescript
const count = signal(0);
// Signals are getter functions - calling them reads their value.
console.log('The count is: ' + count());
```

To change the value of a writable signal, either `.set()` it directly:

```typescript
count.set(1);
```

or use the `.update()` operation to compute a new value from the previous one:

```typescript
// Increment the count by 1.
count.update(value => value + 1);
```

Writable signals have the type `WritableSignal`.

### Computed signals

**Computed signal** are read-only signals that derive their value from other signals. You define computed signals using the `computed` function and specifying a derivation:

```typescript
const count: WritableSignal<number> = signal(0);
const doubleCount: Signal<number> = computed(() => count() * 2);
```

The `doubleCount` signal depends on the `count` signal. Whenever `count` updates, Angular knows that `doubleCount` needs to update as well.

#### Computed signals are both lazily evaluated and memoized

`doubleCount`'s derivation function does not run to calculate its value until the first time you read `doubleCount`. The calculated value is then cached, and if you read `doubleCount` again, it will return the cached value without recalculating.

If you then change `count`, Angular knows that `doubleCount`'s cached value is no longer valid, and the next time you read `doubleCount` its new value will be calculated.

As a result, you can safely perform computationally expensive derivations in computed signals, such as filtering arrays.

#### Computed signals are not writable signals

You cannot directly assign values to a computed signal. That is,

```typescript
doubleCount = 0;
```

produces a compilation error, because `doubleCount` is not a `WritableSignal`.

#### Computed signal dependencies are dynamic

Only the signals actually read during the derivation are tracked. For example, in this `computed` the `count` signal is only read if the `showCount` signal is true:

```typescript
const showCount = signal(false);
const count = signal(0);

const conditionalCount = computed(() => {
  if (showCount()) {
    return `The count is ${count()}.`;
  } else {
    return 'Nothing to see here!';
  }
});
```

When you read `conditionalCount`, if `showCount` is `false` the "Nothing to see here!" message is returned _without_ reading the `count` signal. This means that if you later update `count` it will _not_ result in a recomputation of `conditionalCount`.

If you set `showCount` to `true` and then read `conditionalCount` again, the derivation will re-execute and take the branch where `showCount` is `true`, returning the message which shows the value of `count`. Changing `count` will then invalidate `conditionalCount`'s cached value.

Note that dependencies can be removed during a derivation as well as added. If you later set `showCount` back to `false`, then `count` will no longer be considered a dependency of `conditionalCount`.

# Reading signals in `OnPush` components

When you read a signal within an `OnPush` component's template, Angular tracks the signal as a dependency of that component. When the value of that signal changes, Angular automatically [marks](https://v18.angular.dev/api/core/ChangeDetectorRef#markforcheck) the component to ensure it gets updated the next time change detection runs. Refer to the [Skipping component subtrees](https://v18.angular.dev/best-practices/skipping-subtrees) guide for more information about `OnPush` components.

# Effects

Signals are useful because they notify interested consumers when they change. An **effect** is an operation that runs whenever one or more signal values change. You can create an effect with the `effect` function:

```typescript
effect(() => {
  console.log(`The current count is: ${count()}`);
});
```

Effects always run **at least once.** When an effect runs, it tracks any signal value reads. Whenever any of these signal values change, the effect runs again. Similar to computed signals, effects keep track of their dependencies dynamically, and only track signals which were read in the most recent execution.

Effects always execute **asynchronously**, during the change detection process.

### Use cases for effects

Effects are rarely needed in most application code, but may be useful in specific circumstances. Here are some examples of situations where an `effect` might be a good solution:

*   Logging data being displayed and when it changes, either for analytics or as a debugging tool.
*   Keeping data in sync with `window.localStorage`.
*   Adding custom DOM behavior that can't be expressed with template syntax.
*   Performing custom rendering to a `<canvas>`, charting library, or other third party UI library.

### When not to use effects

Avoid using effects for propagation of state changes. This can result in `ExpressionChangedAfterItHasBeenChecked` errors, infinite circular updates, or unnecessary change detection cycles.

Because of these risks, Angular by default prevents you from setting signals in effects. It can be enabled if absolutely necessary by setting the `allowSignalWrites` flag when you create an effect.

Instead, use `computed` signals to model state that depends on other state.

### Injection context

By default, you can only create an `effect()` within an [injection context](https://v18.angular.dev/guide/di/dependency-injection-context) (where you have access to the `inject` function). The easiest way to satisfy this requirement is to call `effect` within a component, directive, or service `constructor`:

```typescript
@Component({...})
export class EffectiveCounterComponent {
  readonly count = signal(0);

  constructor() {
    // Register a new effect.
    effect(() => {
      console.log(`The count is: ${this.count()}`);
    });
  }
}
```

Alternatively, you can assign the effect to a field (which also gives it a descriptive name).

```typescript
@Component({...})
export class EffectiveCounterComponent {
  readonly count = signal(0);

  private loggingEffect = effect(() => {
    console.log(`The count is: ${this.count()}`);
  });
}
```

To create an effect outside of the constructor, you can pass an `Injector` to `effect` via its options:

```typescript
@Component({...})
export class EffectiveCounterComponent {
  readonly count = signal(0);

  constructor(private injector: Injector) {}

  initializeLogging(): void {
    effect(() => {
      console.log(`The count is: ${this.count()}`);
    }, {injector: this.injector});
  }
}
```

### Destroying effects

When you create an effect, it is automatically destroyed when its enclosing context is destroyed. This means that effects created within components are destroyed when the component is destroyed. The same goes for effects within directives, services, etc.

Effects return an `EffectRef` that you can use to destroy them manually, by calling the `.destroy()` method. You can combine this with the `manualCleanup` option to create an effect that lasts until it is manually destroyed. Be careful to actually clean up such effects when they're no longer required.

# Advanced topics

### Signal equality functions

When creating a signal, you can optionally provide an equality function, which will be used to check whether the new value is actually different than the previous one.

```typescript
import _ from 'lodash';

const data = signal(['test'], {equal: _.isEqual});

// Even though this is a different array instance, the deep equality
// function will consider the values to be equal, and the signal won't
// trigger any updates.
data.set(['test']);
```

Equality functions can be provided to both writable and computed signals.

**HELPFUL:** By default, signals use referential equality ([`Object.is()`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/is) comparison).

### Reading without tracking dependencies

Rarely, you may want to execute code which may read signals within a reactive function such as `computed` or `effect` _without_ creating a dependency.

For example, suppose that when `currentUser` changes, the value of a `counter` should be logged. you could create an `effect` which reads both signals:

```typescript
effect(() => {
  console.log(`User set to ${currentUser()} and the counter is ${counter()}`);
});
```

This example will log a message when _either_ `currentUser` or `counter` changes. However, if the effect should only run when `currentUser` changes, then the read of `counter` is only incidental and changes to `counter` shouldn't log a new message.

You can prevent a signal read from being tracked by calling its getter with `untracked`:

```typescript
effect(() => {
  console.log(`User set to ${currentUser()} and the counter is ${untracked(counter)}`);
});
```

`untracked` is also useful when an effect needs to invoke some external code which shouldn't be treated as a dependency:

```typescript
effect(() => {
  const user = currentUser();
  untracked(() => {
    // If the `loggingService` reads signals, they won't be counted as
    // dependencies of this effect.
    this.loggingService.log(`User set to ${user}`);
  });
});
```

### Effect cleanup functions

Effects might start long-running operations, which you should cancel if the effect is destroyed or runs again before the first operation finished. When you create an effect, your function can optionally accept an `onCleanup` function as its first parameter. This `onCleanup` function lets you register a callback that is invoked before the next run of the effect begins, or when the effect is destroyed.

```typescript
effect((onCleanup) => {
    const user = currentUser();
    const timer = setTimeout(() => {
        console.log(`1 second ago, the user became ${user}`);
    }, 1000);

    onCleanup(() => {
        clearTimeout(timer);
    });
});
```




# Signal inputs

Signal inputs allow values to be bound from parent components. Those values are exposed using a `Signal` and can change during the lifecycle of your component.

Angular supports two variants of inputs:

**Optional inputs** Inputs are optional by default, unless you use `input.required`. You can specify an explicit initial value, or Angular will use `undefined` implicitly.

**Required inputs** Required inputs always have a value of the given input type. They are declared using the `input.required` function.

```typescript
import {Component, input} from '@angular/core';

@Component({...})
export class MyComp {
  // optional
  firstName = input<string>();         // InputSignal<string|undefined>
  age = input(0);                      // InputSignal<number>

  // required
  lastName = input.required<string>(); // InputSignal<string>
}
```

An input is automatically recognized by Angular whenever you use the `input` or `input.required` functions as initializer of class members.

## Aliasing an input


Angular uses the class member name as the name of the input. You can alias inputs to change their public name to be different.

```typescript
class StudentDirective {
  age = input(0, {alias: 'studentAge'});
}
```

This allows users to bind to your input using `[studentAge]`, while inside your component you can access the input values using `this.age`.

## Using in templates


Signal inputs are read-only signals. As with signals declared via `signal()`, you access the current value of the input by calling the input signal.

```html
<p>First name: {{firstName()}}</p>
<p>Last name: {{lastName()}}</p>
```

This access to the value is captured in reactive contexts and can notify active consumers, like Angular itself, whenever the input value changes.

An input signal in practice is a trivial extension of signals that you know from the signals guide.

```typescript
export class InputSignal<T> extends Signal<T> { ... }
```

## Deriving values


As with signals, you can derive values from inputs using `computed`.

```typescript
import {Component, input, computed} from '@angular/core';

@Component({...})
export class MyComp {
  age = input(0);

  // age multiplied by two.
  ageMultiplied = computed(() => this.age() * 2);
}
```

Computed signals memoize values. See more details in the dedicated section for computed.

## Monitoring changes


With signal inputs, users can leverage the `effect` function. The function will execute whenever the input changes.

Consider the following example. The new value is printed to the console whenever the `firstName` input changes.

```typescript
import {input, effect} from '@angular/core';

class MyComp {
  firstName = input.required<string>();

  constructor() {
    effect(() => {
      console.log(this.firstName());
    });
  }
}
```

The `console.log` function is invoked every time the `firstName` input changes. This will happen as soon as `firstName` is available, and for subsequent changes during the lifetime of `MyComp`.

## Value transforms


You may want to coerce or parse input values without changing the meaning of the input. Transforms convert the raw value from parent templates to the expected input type. Transforms should be pure functions.

```typescript
class MyComp {
  disabled = input(false, {
    transform: (value: boolean|string) => typeof value === 'string' ? value === '' : value,
  });
}
```

In the example above, you are declaring an input named `disabled` that is accepting values of type `boolean` and `string`. This is captured by the explicit parameter type of `value` in the `transform` option. These values are then parsed to a `boolean` with the transform, resulting in booleans.

That way, you are only dealing with `boolean` inside your component when calling `this.disabled()`, while users of your component can pass an empty string as a shorthand to mark your component as disabled.

```html
<my-custom-comp disabled>
```

**IMPORTANT:** Do not use transforms if they change the meaning of the input, or if they are impure. Instead, use `computed` for transformations with different meaning, or an `effect` for impure code that should run whenever the input changes.

## Why should we use signal inputs and not `@Input()`?


Signal inputs are a reactive alternative to decorator-based `@Input()`.

In comparison to decorator-based `@Input`, signal inputs provide numerous benefits:

1.  Signal inputs are more **type safe**:
    • Required inputs do not require initial values, or tricks to tell TypeScript that an input _always_ has a value.
    • Transforms are automatically checked to match the accepted input values.
2.  Signal inputs, when used in templates, will **automatically** mark `OnPush` components as dirty.
3.  Values can be easily **derived** whenever an input changes using `computed`.
4.  Easier and more local monitoring of inputs using `effect` instead of `ngOnChanges` or setters.






# Model inputs

**Model inputs** are a special type of input that enable a component to propagate new values back to another component.

When creating a component, you can define a model input similarly to how you create a standard input.

```typescript
import {Component, model, input} from '@angular/core';

@Component({...})
export class CustomCheckbox {
  // This is a model input.
  checked = model(false);

  // This is a standard input.
  disabled = input(false);
}
```

Both types of input allow someone to bind a value into the property. However, **model inputs allow the component author to write values into the property**.

In other respects, you can use model inputs the same way you use standard inputs. You can read the value by calling the signal function, including in reactive contexts like `computed` and `effect`.

```typescript
import {Component, model, input} from '@angular/core';

@Component({
  selector: 'custom-checkbox',
  template: '<div (click)="toggle()"> ... </div>',
})
export class CustomCheckbox {
  checked = model(false);
  disabled = input(false);

  toggle() {
    // While standard inputs are read-only, you can write directly to model inputs.
    this.checked.set(!this.checked());
  }
}
```

When a component writes a new value into a model input, Angular can propagate the new value back to the component that is binding a value into that input. This is called **two-way binding** because values can flow in both directions.

# Two-way binding with signals

You can bind a writable signal to a model input.

```typescript
import { Component, signal } from '@angular/core';
import { CustomCheckbox } from './custom-checkbox.component'; // Assuming CustomCheckbox is in a separate file

@Component({
  selector: 'user-profile',
  standalone: true, // Add if needed
  imports: [CustomCheckbox], // Import the CustomCheckbox component
  // `checked` is a model input.
  // The parenthesis-inside-square-brackets syntax (aka "banana-in-a-box") creates a two-way binding
  template: '<custom-checkbox [(checked)]="isAdmin" />',
})
export class UserProfile {
  protected isAdmin = signal(false);
}
```

In the above example, the `CustomCheckbox` can write values into its `checked` model input, which then propagates those values back to the `isAdmin` signal in `UserProfile`. This binding keeps that values of `checked` and `isAdmin` in sync. Notice that the binding passes the `isAdmin` signal itself, not the _value_ of the signal.

# Two-way binding with plain properties

You can bind a plain JavaScript property to a model input.

```typescript
import { Component } from '@angular/core';
import { CustomCheckbox } from './custom-checkbox.component'; // Assuming CustomCheckbox is in a separate file

@Component({
  selector: 'user-profile',
  standalone: true, // Add if needed
  imports: [CustomCheckbox], // Import the CustomCheckbox component
  // `checked` is a model input.
  // The parenthesis-inside-square-brackets syntax (aka "banana-in-a-box") creates a two-way binding
  template: '<custom-checkbox [(checked)]="isAdmin" />',
})
export class UserProfile {
  protected isAdmin = false;
}
```

In the example above, the `CustomCheckbox` can write values into its `checked` model input, which then propagates those values back to the `isAdmin` property in `UserProfile`. This binding keeps that values of `checked` and `isAdmin` in sync.

# Implicit `change` events

When you declare a model input in a component or directive, Angular automatically creates a corresponding output for that model. The output's name is the model input's name suffixed with "Change".

```typescript
import { Directive, model } from '@angular/core';

@Directive({...})
export class CustomCheckbox {
  // This automatically creates an output named "checkedChange".
  // Can be subscribed to using `(checkedChange)="handler()"` in the template.
  checked = model(false);
}
```

Angular emits this change event whenever you write a new value into the model input by calling its `set` or `update` methods.

# Customizing model inputs

You can mark a model input as required or provide an alias in the same way as a standard input.

Model inputs do not support input transforms.

# Differences between `model()` and `input()`

Both `input()` and `model()` functions are ways to define signal-based inputs in Angular, but they differ in a few ways:

1.  `model()` defines **both** an input and an output. The output's name is always the name of the input suffixed with `Change` to support two-way bindings. It will be up to the consumer of your directive to decide if they want to use just the input, just the output, or both.
2.  `ModelSignal` is a `WritableSignal` which means that its value can be changed from anywhere using the `set` and `update` methods. When a new value is assigned, the `ModelSignal` will emit to its output. This is different from `InputSignal` which is read-only and can only be changed through the template.
3.  Model inputs do not support input transforms while signal inputs do.

# When to use model inputs

Use model inputs when you want a component to support two-way binding. This is typically appropriate when a component exists to modify a value based on user interaction. Most commonly, custom form controls such as a date picker or combobox should use model inputs for their primary value.


# HTTP resource signals

```typescript
import { Component } from '@angular/core';
import { resource } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { signal } from '@angular/core';

@Component({
  selector: 'app-resource-example',
  template: `
    <div *ngIf="items.loading">Loading...</div>
    <div *ngIf="items.error">Error: {{ items.error.message }}</div>
    <ul *ngIf="items.data">
      <li *ngFor="let item of items.data">{{ item.name }}</li>
    </ul>
  `,
})
export class ResourceExampleComponent {
  itemId = signal(1);
  items = resource(() => this.itemId(), (id) => 
    this.http.get<any[]>(`/api/items/${id}`)
  );

  constructor(private http: HttpClient) {}
}
```


# Untagged template literals in expressions

Angular 19.2 introduces an improvement related to template literals, previously unsupported in HTML templates. This enhancement simplifies how we combine variables with text in templates.

In earlier versions of Angular, if we wanted to include text with an embedded variable in a template, we often had to use the traditional string concatenation operator (+). For example:

```
{{ 'Ala has ' + count + ' cats' }}

{{ cartCount() === 0 ? 'Your cart is empty.' : 'You have ' + cartCount() + ' items in your cart.' }}
```

The variable count was concatenated with text using the + operator in this case. While functional, this approach introduced some rigidity and required longer, less elegant expressions in the template.

Starting from version 19.2, Angular allows template literals – a modern string interpolation method that is more readable and concise. We can now use the following syntax:

```
{{ `Ala has ${count} cats` }}

{{ cartCount() === 0 ? 'Your cart is empty.' : `You have ${cartCount()} items in your cart.` }}
```

Instead of using the + operator, we insert variables directly into the string using ${}. This approach is more elegant, improves readability, and makes templates more manageable to maintain, especially for longer or more complex text strings.

# New Features of NgComponentOutlet

NgComponentOutlet is a directive in Angular that allows the dynamic loading of components at a specified location within an application. In previous versions, its usage was limited to the .ts file. That was the case until Angular 19.1.

Before this update, to dynamically load a component:

We had to use Angular’s API in the TypeScript file, such as ComponentFactoryResolver, to create component instances.
This was more complex as it required TypeScript code to manage the creation and injection of components.
Example of the previous approach:
```typescript
import { Component, ComponentFactoryResolver, ViewChild, ViewContainerRef } from '@angular/core';

@Component({
selector: 'app-root',
template: '<ng-container #dynamicContainer></ng-container>',
})
export class AppComponent {
    @ViewChild('dynamicContainer', { read: ViewContainerRef }) container!: ViewContainerRef;
    
    constructor(private resolver: ComponentFactoryResolver) {}
        loadComponent(component: any) {
        const factory = this.resolver.resolveComponentFactory(component);
        this.container.clear();
        this.container.createComponent(factory);
    }
}
```
In the latest version of Angular, we can dynamically load components directly in the HTML file using NgComponentOutlet. We no longer need to create component instances in the TypeScript code. Here’s an example:
```
<ng-container
*ngComponentOutlet="dynamicComponent"
#outlet="ngComponentOutlet">
</ng-container>
```

- *ngComponentOutlet=”dynamicComponent”
    - Angular loads the component specified by the dynamicComponent variable. This variable can be a component class passed from the TypeScript file.
- #outlet=”ngComponentOutlet”
    - A local context (#outlet) is created, allowing interaction with the loaded component (e.g., access to the component’s instance and its API).

In the .ts file, we have the following code:

```typescript
import { Component } from '@angular/core';
import { MyDynamicComponent } from './my-dynamic.component';

@Component({
selector: 'app-root',
templateUrl: './app.component.html',
})
export class AppComponent {
dynamicComponent = MyDynamicComponent;=
}
```
This has significantly simplified the process of dynamically loading components, eliminating the need to create component instances in the TypeScript code and providing greater flexibility in creating dynamic components.

This directive has also gained a new property—componentInstance. With it, we now have access to the instance of the component created by the directive.

With componentInstance, you can:

- Access the methods and properties of the component.
- Update data or pass new values to the component after it has been loaded.
- Perform operations on the loaded component, which was more difficult before because NgComponentOutlet did not provide direct access to the instance.


# RxJS Interoperability

The `@angular/rxjs-interop` package offers APIs to integrate RxJS and Angular signals.

## Create a signal from an RxJS Observable with `toSignal`

Use the `toSignal` function to create a signal that tracks an Observable's value. It behaves similarly to the `async` pipe in templates but is more flexible and can be used anywhere.

```typescript
import { Component } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { interval } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  template: `{{ counter() }}`,
})
export class Ticker {
  counterObservable = interval(1000);
  // Get a `Signal` representing the `counterObservable`'s value.
  counter = toSignal(this.counterObservable, { initialValue: 0 });
}
```

Like the `async` pipe, `toSignal` subscribes to the Observable immediately, which may trigger side effects. The subscription automatically unsubscribes when the component or service calling `toSignal` is destroyed.

**IMPORTANT:** `toSignal` creates a subscription. Avoid calling it repeatedly for the same Observable; reuse the signal it returns instead.

### Injection Context

By default, `toSignal` needs to run in an injection context (e.g., during component or service construction). If an injection context is unavailable, you can manually specify the `Injector`.

### Initial Values

Observables may not produce a value synchronously on subscription, but signals always require a current value. There are several ways to handle the initial value of `toSignal` signals.

#### The `initialValue` option

As in the example, you can specify an `initialValue` option for the signal to return before the Observable emits for the first time.

#### `undefined` Initial Values

If no `initialValue` is provided, the signal will return `undefined` until the Observable emits. This is similar to the `async` pipe's `null` behavior.

#### The `requireSync` option

For Observables guaranteed to emit synchronously (e.g., `BehaviorSubject`), you can specify `requireSync: true`.

When `requireSync` is `true`, `toSignal` enforces synchronous emission on subscription, ensuring the signal always has a value and no `undefined` type or initial value is required.

### `manualCleanup`

By default, `toSignal` automatically unsubscribes from the Observable when its creating component or service is destroyed.

To override this, pass the `manualCleanup` option. This is useful for Observables that complete naturally.

### Error and Completion

If an Observable used in `toSignal` produces an error, the error is thrown when the signal is read.

If an Observable used in `toSignal` completes, the signal continues to return its most recently emitted value.

## Create an RxJS Observable from a signal with `toObservable`

Use the `toObservable` utility to create an `Observable` that tracks a signal's value. The signal's value is monitored with an `effect` which emits the value to the Observable when it changes.

```typescript
import { Component, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

@Component(...)
export class SearchResults {
  query: Signal<string> = inject(QueryService).query;
  query$ = toObservable(this.query);
  results$ = this.query$.pipe(
    switchMap(query => this.http.get('/search?q=' + query ))
  );
}
```

As the `query` signal changes, the `query$` Observable emits the latest query, triggering a new HTTP request.

### Injection Context

By default, `toObservable` needs to run in an injection context (e.g., during component or service construction). If an injection context is unavailable, you can manually specify the `Injector`.

### Timing of `toObservable`

`toObservable` uses an effect to track the signal's value in a `ReplaySubject`. On subscription, the first value (if available) may be emitted synchronously; subsequent values will be asynchronous.

Unlike Observables, signals never provide synchronous change notifications. Even with multiple signal updates, `toObservable` will only emit the value after the signal stabilizes.

```typescript
const obs$ = toObservable(mySignal);
obs$.subscribe(value => console.log(value));
mySignal.set(1);
mySignal.set(2);
mySignal.set(3);
```

Here, only the last value (3) will be logged.


# Angular code guidelines

# Angular API Service Best Practices Guide

## Overview

This guide establishes patterns for Angular services that interact with APIs, emphasizing:
- **Minimal component code** - Components only trigger actions and react to state
- **Type safety** - From API definitions to navigation
- **Signal-based state management** - Using Angular's latest reactive primitives
- **Non-blocking operations** - Keeping the UI responsive
- **Flexible navigation** - Components control navigation based on context

## Core Framework Code

### 1. API State Types

```typescript
// core/api-state.types.ts
import { signal, WritableSignal } from '@angular/core';

export type ApiState<T> = 
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error; code?: number };

export type ApiListState<T> = ApiState<T[]>;

export type ApiEntityState<T> = 
  | ApiState<T>
  | { status: 'not_found' }
  | { status: 'forbidden' };

export function createApiListState<T>(): WritableSignal<ApiListState<T>> {
  return signal<ApiListState<T>>({ status: 'idle' });
}

export function createApiEntityState<T>(): WritableSignal<ApiEntityState<T>> {
  return signal<ApiEntityState<T>>({ status: 'idle' });
}
```

### 2. Type-Safe Route Definitions

```typescript
// Example: routes/entities.routes.ts
const BASE = '/ui/entities';

export const ENTITIES_ROUTES = {
  segments: {
    list: '',
    new: 'new',
    detail: ':entityId',
    edit: ':entityId/edit',
  },
  nav: {
    list: () => [BASE],
    new: () => [BASE, 'new'],
    detail: (id: string) => [BASE, id],
    edit: (id: string) => [BASE, id, 'edit'],
  }
} as const;
```

## Service Implementation Pattern

Services should:
1. **Expose only readonly signals** for state
2. **Use void methods for loading** operations (non-blocking)
3. **Return Observables for mutations** (create/update/delete) to allow component control
4. **Update related states** optimistically when appropriate
5. **Prevent duplicate loading requests** by checking state

### Example Service

```typescript
// services/entities.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, tap, EMPTY, map } from 'rxjs';
import { callApiRoute } from 'app/core/api-route';
import { ENTITY_API } from '#shared/api/entities.api';
import { createApiListState, createApiEntityState } from 'app/core/api-state.types';
import type { Entity, EntityPreview, EntityCreatePayload, EntityUpdatePayload } from '../models/entity.model';

@Injectable({ providedIn: 'root' })
export class EntitiesService {
  private readonly httpClient = inject(HttpClient);
  
  // Private writable state
  private readonly _entitiesState = createApiListState<EntityPreview>();
  private readonly _selectedEntityState = createApiEntityState<Entity>();
  
  // Public readonly state
  readonly entitiesState = this._entitiesState.asReadonly();
  readonly selectedEntityState = this._selectedEntityState.asReadonly();
  
  // Loading operations - void return, subscribe internally
  loadEntities(): void {
    if (this._entitiesState().status === 'loading') return;
    
    this._entitiesState.set({ status: 'loading' });
    
    callApiRoute(this.httpClient, ENTITY_API.listEntities).pipe(
      tap(response => {
        this._entitiesState.set({ status: 'success', data: response.entities });
      }),
      catchError(error => {
        this._entitiesState.set({ 
          status: 'error', 
          error: error instanceof Error ? error : new Error('Failed to load entities'),
          code: error?.status
        });
        return EMPTY;
      })
    ).subscribe();
  }
  
  loadEntity(entityId: string): void {
    if (this._selectedEntityState().status === 'loading') return;
    
    this._selectedEntityState.set({ status: 'loading' });
    
    callApiRoute(this.httpClient, ENTITY_API.getEntityById, { pathParams: { entityId } }).pipe(
      tap(entity => {
        this._selectedEntityState.set({ status: 'success', data: entity as Entity });
      }),
      catchError(error => {
        if (error?.status === 404) {
          this._selectedEntityState.set({ status: 'not_found' });
        } else if (error?.status === 403) {
          this._selectedEntityState.set({ status: 'forbidden' });
        } else {
          this._selectedEntityState.set({ 
            status: 'error', 
            error: error instanceof Error ? error : new Error('Failed to load entity'),
            code: error?.status
          });
        }
        return EMPTY;
      })
    ).subscribe();
  }
  
  // Mutation operations - return Observable for component control
  createEntity(payload: EntityCreatePayload): Observable<Entity> {
    return callApiRoute(this.httpClient, ENTITY_API.createEntity, { body: payload }).pipe(
      tap(newEntity => {
        // Optimistically update list
        const currentState = this._entitiesState();
        if (currentState.status === 'success') {
          this._entitiesState.set({
            status: 'success',
            data: [...currentState.data, newEntity as EntityPreview]
          });
        }
      }),
      map(response => response as Entity)
    );
  }
  
  updateEntity(entityId: string, payload: EntityUpdatePayload): Observable<Entity> {
    return callApiRoute(this.httpClient, ENTITY_API.updateEntity, { pathParams: { entityId }, body: payload }).pipe(
      tap(updatedEntity => {
        // Update selected entity
        const currentSelected = this._selectedEntityState();
        if (currentSelected.status === 'success' && currentSelected.data.id === entityId) {
          this._selectedEntityState.set({ status: 'success', data: updatedEntity as Entity });
        }
        // Update in list
        const currentList = this._entitiesState();
        if (currentList.status === 'success') {
          this._entitiesState.set({
            status: 'success',
            data: currentList.data.map(e => e.id === entityId ? { ...e, ...updatedEntity } : e)
          });
        }
      }),
      map(response => response as Entity)
    );
  }
  
  deleteEntity(entityId: string): Observable<void> {
    return callApiRoute(this.httpClient, ENTITY_API.deleteEntity, { pathParams: { entityId } }).pipe(
      tap(() => {
        // Update list
        const currentList = this._entitiesState();
        if (currentList.status === 'success') {
          this._entitiesState.set({
            status: 'success',
            data: currentList.data.filter(e => e.id !== entityId)
          });
        }
        // Clear selected if deleted
        const currentSelected = this._selectedEntityState();
        if (currentSelected.status === 'success' && currentSelected.data.id === entityId) {
          this._selectedEntityState.set({ status: 'idle' });
        }
      }),
      map(() => void 0)
    );
  }
  
  clearSelectedEntity(): void {
    this._selectedEntityState.set({ status: 'idle' });
  }
}
```

## Component Patterns

### List Component

```typescript
// components/entity-list.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EntitiesService } from '../services/entities.service';
import { ENTITIES_ROUTES } from '../routes/entities.routes';

@Component({
  selector: 'app-entity-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="header">
      <h1>Entities</h1>
      <a [routerLink]="routes.nav.new()" class="btn">New Entity</a>
    </div>
    
    @switch (entitiesState().status) {
      @case ('idle') {
        <p>Loading entities...</p>
      }
      @case ('loading') {
        <app-spinner />
      }
      @case ('success') {
        @if (entitiesState().data.length === 0) {
          <p>No entities found. Create your first one!</p>
        } @else {
          <div class="entity-grid">
            @for (entity of entitiesState().data; track entity.id) {
              <div class="entity-card">
                <h3>{{ entity.name }}</h3>
                <p>{{ entity.description }}</p>
                <div class="actions">
                  <a [routerLink]="routes.nav.detail(entity.id)">View</a>
                  <button (click)="deleteEntity(entity.id)" class="danger">Delete</button>
                </div>
              </div>
            }
          </div>
        }
      }
      @case ('error') {
        <app-error-message 
          message="Failed to load entities"
          (retry)="loadEntities()" />
      }
    }
  `
})
export class EntityListComponent implements OnInit {
  private readonly entitiesService = inject(EntitiesService);
  private readonly destroyRef = inject(DestroyRef);
  
  readonly entitiesState = this.entitiesService.entitiesState;
  readonly routes = ENTITIES_ROUTES;
  
  ngOnInit() {
    this.loadEntities();
  }
  
  loadEntities() {
    this.entitiesService.loadEntities();
  }
  
  deleteEntity(entityId: string) {
    if (confirm('Delete this entity?')) {
      this.entitiesService.deleteEntity(entityId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            // Could show success toast here
            // No navigation needed - staying on list
          },
          error: (error) => {
            console.error('Failed to delete entity:', error);
            // Could show error toast
          }
        });
    }
  }
}
```

### Create/Edit Component

```typescript
// components/entity-form.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EntitiesService } from '../services/entities.service';
import { ENTITIES_ROUTES } from '../routes/entities.routes';

@Component({
  selector: 'app-entity-form',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <h1>{{ isEditMode ? 'Edit' : 'Create' }} Entity</h1>
      
      <div class="form-group">
        <label for="name">Name</label>
        <input id="name" formControlName="name" />
        @if (form.get('name')?.invalid && form.get('name')?.touched) {
          <span class="error">Name is required</span>
        }
      </div>
      
      <div class="form-group">
        <label for="description">Description</label>
        <textarea id="description" formControlName="description"></textarea>
      </div>
      
      <div class="actions">
        <button type="submit" [disabled]="form.invalid || isSubmitting">
          {{ isSubmitting ? 'Saving...' : 'Save' }}
        </button>
        <button type="button" (click)="cancel()">Cancel</button>
      </div>
      
      @if (errorMessage) {
        <div class="error-message">{{ errorMessage }}</div>
      }
    </form>
  `
})
export class EntityFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly entitiesService = inject(EntitiesService);
  private readonly destroyRef = inject(DestroyRef);
  
  form = this.fb.group({
    name: ['', Validators.required],
    description: ['']
  });
  
  isEditMode = false;
  isSubmitting = false;
  errorMessage = '';
  private entityId?: string;
  
  ngOnInit() {
    this.entityId = this.route.snapshot.params['entityId'];
    this.isEditMode = !!this.entityId;
    
    if (this.isEditMode && this.entityId) {
      // Load existing entity data
      const currentEntity = this.entitiesService.selectedEntityState();
      if (currentEntity.status === 'success' && currentEntity.data.id === this.entityId) {
        this.form.patchValue(currentEntity.data);
      }
    }
  }
  
  onSubmit() {
    if (this.form.invalid || this.isSubmitting) return;
    
    this.isSubmitting = true;
    this.errorMessage = '';
    
    const operation = this.isEditMode && this.entityId
      ? this.entitiesService.updateEntity(this.entityId, this.form.value)
      : this.entitiesService.createEntity(this.form.value);
    
    operation
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entity) => {
          // Navigate to the entity detail page
          this.router.navigate(ENTITIES_ROUTES.nav.detail(entity.id));
        },
        error: (error) => {
          this.isSubmitting = false;
          this.errorMessage = 'Failed to save entity. Please try again.';
          console.error('Save failed:', error);
        }
      });
  }
  
  cancel() {
    if (this.isEditMode && this.entityId) {
      this.router.navigate(ENTITIES_ROUTES.nav.detail(this.entityId));
    } else {
      this.router.navigate(ENTITIES_ROUTES.nav.list());
    }
  }
}
```

### Detail Component

```typescript
// components/entity-detail.component.ts
// components/entity-detail.component.ts
import { Component, OnInit, inject, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EntitiesService } from '../services/entities.service';
import { ENTITIES_ROUTES } from '../routes/entities.routes';

@Component({
  selector: 'app-entity-detail',
  standalone: true,
  template: `
    @switch (entityState().status) {
      @case ('idle') {
        <!-- Initial load -->
      }
      @case ('loading') {
        <app-spinner />
      }
      @case ('success') {
        <article>
          <h1>{{ entityState().data.name }}</h1>
          <p>{{ entityState().data.description }}</p>
          <div class="actions">
            <button (click)="editEntity()">Edit</button>
            <button (click)="deleteEntity()" class="danger">Delete</button>
          </div>
        </article>
      }
      @case ('not_found') {
        <app-not-found message="Entity not found" />
      }
      @case ('forbidden') {
        <app-forbidden message="You don't have access to this entity" />
      }
      @case ('error') {
        <app-error-message 
          message="Failed to load entity"
          (retry)="loadEntity()" />
      }
    }
  `
})
export class EntityDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly entitiesService = inject(EntitiesService);
  private readonly destroyRef = inject(DestroyRef);
  
  readonly entityState = this.entitiesService.selectedEntityState;
  private entityId!: string;
  
  constructor() {
    // Auto-navigate away on not found/forbidden
    effect(() => {
      const state = this.entityState();
      if (state.status === 'not_found' || state.status === 'forbidden') {
        this.router.navigate(ENTITIES_ROUTES.nav.list());
      }
    });
  }
  
  ngOnInit() {
    this.entityId = this.route.snapshot.params['entityId'];
    this.loadEntity();
  }
  
  ngOnDestroy() {
    this.entitiesService.clearSelectedEntity();
  }
  
  loadEntity() {
    this.entitiesService.loadEntity(this.entityId);
  }
  
  editEntity() {
    this.router.navigate(ENTITIES_ROUTES.nav.edit(this.entityId));
  }
  
  deleteEntity() {
    if (confirm('Delete this entity?')) {
      this.entitiesService.deleteEntity(this.entityId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            // Navigate to list after successful deletion
            this.router.navigate(ENTITIES_ROUTES.nav.list());
          },
          error: (error) => {
            console.error('Failed to delete entity:', error);
            // Could show error toast/dialog
          }
        });
    }
  }
}
```

Key Principles Summary
1. State Management
   Use signals exclusively (no BehaviorSubject)
   Expose only readonly signals from services
   Use discriminated unions for type-safe state handling
2. API Calls
   Loading operations (GET): void methods that subscribe internally
   Mutation operations (POST/PUT/DELETE): return Observables for component control
   Use callApiRoute for type-safe API calls
   Never use toPromise() or await
3. Navigation
   Components handle navigation after mutations
   This provides flexibility for different contexts (list vs detail views)
   Use type-safe route constants
4. Component Patterns
   Minimal logic - primarily trigger service methods and react to state
   Use @switch for exhaustive state handling
   Use takeUntilDestroyed for subscription cleanup
   Handle form states (loading, errors) locally
5. Error Handling
   Distinguish between error types (404, 403, network)
   Provide retry mechanisms in the UI
   Show appropriate error messages in forms
