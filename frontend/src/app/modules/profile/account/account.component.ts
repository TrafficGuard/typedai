import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    ViewEncapsulation,
    inject, // Added inject
    DestroyRef, // Added DestroyRef
    effect, // Added effect
} from '@angular/core';
import { LlmService, LLM } from '../../llm.service';
// Removed BehaviorSubject
import {
    FormGroup,
    FormControl,
    Validators,
    ReactiveFormsModule,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
// Removed HttpClient
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from "@angular/material/select";
import { CommonModule } from "@angular/common";
// USER_API is not directly used in the component anymore, but keep the import for reference if needed elsewhere
// import { USER_API } from '#shared/api/user.api';
import { UserProfileUpdate, UserProfile } from "#shared/schemas/user.schema";
import {UserService} from "../../../core/user/user.service";
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'; // Added takeUntilDestroyed
// toObservable is not needed if using effect for patching
// import { toObservable } from '@angular/core/rxjs-interop';


@Component({
    selector: 'settings-account',
    templateUrl: './account.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
        CommonModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatSelectModule,
        ReactiveFormsModule,
    ],
})
export class SettingsAccountComponent implements OnInit {
    private readonly destroyRef = inject(DestroyRef); // Injected DestroyRef

    accountForm!: FormGroup; // Use definite assignment assertion as it's initialized in ngOnInit

    // Expose LLM state signal directly to the template
    readonly llmsState = this.llmService.llmsState;

    constructor(
        // Removed private http: HttpClient
        private snackBar: MatSnackBar,
        private llmService: LlmService,
        private userService: UserService,
    ) {
        // Effect to react to user profile changes and patch the form
        effect(() => {
            const user = this.userService.userProfile();
            if (user) {
                // Ensure the form is initialized before patching
                if (this.accountForm) {
                    // Patch the form with the loaded user data
                    // Use patchValue to avoid issues with missing form controls if schema changes
                    this.accountForm.patchValue(user);
                }
            } else {
                 // Optional: If user becomes null (e.g., sign out), reset the form
                 // This might not be necessary depending on app flow, but good practice
                 if (this.accountForm && this.accountForm.dirty) {
                     this.accountForm.reset(); // Or reset to specific defaults
                 }
            }
        });
    }

    // -- Lifecycle hooks -- --

    ngOnInit(): void {
        // Initialize the form structure
        this.accountForm = new FormGroup({
            id: new FormControl({ value: '', disabled: true }), // ID is read-only
            // Removed username: new FormControl(''), as it's not in UserProfileUpdate schema
            email: new FormControl('', [Validators.required, Validators.email]),
            // Removed enabled: new FormControl(false), as it's not in UserProfileUpdate schema
            hilBudget: new FormControl(0),
            hilCount: new FormControl(0),
            llmConfig: new FormGroup({
                anthropicKey: new FormControl(''),
                openaiKey: new FormControl(''),
                groqKey: new FormControl(''),
                togetheraiKey: new FormControl(''),
                fireworksKey: new FormControl(''),
                deepseekKey: new FormControl(''),
                deepinfraKey: new FormControl(''),
                cerebrasKey: new FormControl(''),
                xaiKey: new FormControl(''),
                nebiusKey: new FormControl(''),
                sambanovaKey: new FormControl(''),
                geminiKey: new FormControl(''),
                openrouterKey: new FormControl(''),
            }),
            chat: new FormGroup({
                defaultLLM: new FormControl(''),
                // Add other ChatSettings fields if they become editable and part of the schema
                // temperature: new FormControl(0.7), // Example
                // topP: new FormControl(1.0),       // Example
            }),
            functionConfig: new FormGroup({
                GitHub: new FormGroup({
                    token: new FormControl(''),
                }),
                GitLab: new FormGroup({
                    host: new FormControl(''),
                    token: new FormControl(''),
                    topLevelGroups: new FormControl(''),
                }),
                Jira: new FormGroup({
                    baseUrl: new FormControl(''),
                    email: new FormControl(''),
                    token: new FormControl(''),
                }),
                Slack: new FormGroup({
                    token: new FormControl(''),
                    userId: new FormControl(''),
                    webhookUrl: new FormControl(''),
                }),
                Perplexity: new FormGroup({
                    key: new FormControl(''),
                }),
            }),
        });

        // Patch form immediately if user data is already available (e.g., navigating back to the page)
        // The effect in the constructor handles subsequent changes or initial load if it happens after ngOnInit
        const initialUser = this.userService.userProfile();
        if (initialUser) {
            this.accountForm.patchValue(initialUser);
        }

        // Trigger loading the user profile and LLMs via their services
        this.userService.loadUser();
        this.llmService.loadLlms();

        // Removed the BehaviorSubject and subscription logic for LLMs
    }

    // Removed private loadUserProfile(): void method

    // Save user profile data
    onSave(): void {
        // Mark all controls as touched to display validation errors
        this.accountForm.markAllAsTouched();

        if (this.accountForm.invalid) {
            this.snackBar.open('Please correct the form errors.', 'Close', { duration: 3000 });
            return;
        }

        // Get raw values including disabled controls like 'id' if needed,
        // but 'id' is typically not sent in the update payload.
        const formValues = this.accountForm.getRawValue();

        // Validate defaultChatLlmId exists in available LLMs if one is selected
        const defaultLlmId = formValues.chat.defaultLLM;
        const llmsApiResult = this.llmsState(); // Get the current state of the LLM signal

        if (defaultLlmId) {
            if (llmsApiResult.status === 'success') {
                // Check if the selected LLM ID exists in the successfully loaded data
                if (!llmsApiResult.data.some(llm => llm.id === defaultLlmId)) {
                    this.snackBar.open('Selected default LLM is not available.', 'Close', { duration: 3000 });
                    return;
                }
            } else {
                // Handle case where LLMs are not in a 'success' state but a default is set
                // This prevents saving with a potentially invalid LLM if the list failed to load
                this.snackBar.open('LLM list not available to validate selection. Please try again later.', 'Close', { duration: 3000 });
                return;
            }
        }

        // Construct payload based on UserProfileUpdate schema.
        // Exclude 'id' and any other fields not part of the update schema (like 'username', 'enabled').
        const updateUserPayload: UserProfileUpdate = {
            email: formValues.email,
            chat: {
                defaultLLM: formValues.chat.defaultLLM,
                // Add other ChatSettings fields here if they are in the form and schema
                // For example, if temperature was editable:
                // temperature: formValues.chat.temperature,
            },
            hilBudget: formValues.hilBudget,
            hilCount: formValues.hilCount,
            llmConfig: formValues.llmConfig,
            functionConfig: formValues.functionConfig
        };

        // Use the userService.update method
        this.userService.update(updateUserPayload).pipe(
            // Automatically unsubscribe when the component is destroyed
            takeUntilDestroyed(this.destroyRef)
        ).subscribe({
            next: () => {
                this.snackBar.open('Profile updated', 'Close', { duration: 3000 });
                // The effect will automatically patch the form if the service updates its state
            },
            error: (error) => {
                this.snackBar.open('Failed to save profile.', 'Close', { duration: 3000 });
                console.error('Error saving profile:', error);
                // Optionally handle specific error codes or messages
            }
        });
    }

    // Optional: Implement a cancel method
    onCancel(): void {
        // Patch the form with the current user profile data from the service's signal
        const currentUser = this.userService.userProfile();
        if (currentUser) {
            // Reset the form to the current state from the service
            this.accountForm.patchValue(currentUser);
            // Optionally reset the form's dirty state
            this.accountForm.markAsPristine();
            this.accountForm.markAsUntouched();
        } else {
            // If no user data is available (e.g., initial load failed), reset to empty or default state
            this.accountForm.reset(); // Or patch with specific initial values matching form structure
        }
    }
}
