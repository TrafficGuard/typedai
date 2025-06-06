import { FormControl, FormGroup, FormArray } from '@angular/forms';

// Helper type for the value within a FormControl, allowing null
type FormControlValue<T> = T | null;

/**
 * Converts a model interface `T` into a corresponding Angular FormGroup interface.
 * - Primitive properties (string, number, boolean, Date) become FormControl<Type | null>.
 * - Object properties become FormGroup<ModelToFormGroup<NestedType>>.
 * - Array properties become FormArray of FormControls or FormGroups.
 */
export type ModelToFormGroup<T> = {
    [K in keyof T]-?: T[K] extends string | number | boolean | Date // Check for primitives and Date
        ? FormControl<FormControlValue<T[K]>>
        : T[K] extends Array<infer U> // Check for Array
            ? U extends string | number | boolean | Date // Array of primitives
                ? FormArray<FormControl<FormControlValue<U>>>
                : FormArray<FormGroup<ModelToFormGroup<U>>> // Array of objects
            : T[K] extends object // Check for nested object
                ? FormGroup<ModelToFormGroup<Required<T[K]>>> // Nested FormGroup, ensure all props of nested object are considered
                : FormControl<FormControlValue<T[K]>>; // Fallback for any other types
};
