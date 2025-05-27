import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    ViewEncapsulation,
    inject,
    DestroyRef,
    effect,
} from '@angular/core';
import { LlmService, LLM } from '../../llm.service';
import {
    FormGroup,
    FormControl,
    Validators,
    ReactiveFormsModule,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from "@angular/material/select";
import { CommonModule } from "@angular/common";
import { UserProfileUpdate, UserProfile } from "#shared/schemas/user.schema";
import {UserService} from "../../../core/user/user.service";
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';


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
    private readonly destroyRef = inject(DestroyRef);

    accountForm!: FormGroup;

    // Expose LLM state signal directly to the template
    readonly llmsState = this.llmService.llmsState;
    // Expose UserProfile signal for the template (for view-only email)
    readonly userProfile = this.userService.userProfile;


    constructor(
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
                    // Patch only the fields that exist in the form
                    this.accountForm.patchValue(user);
                    // Patch nested form groups specifically if patchValue doesn't handle them deeply enough
                    if (user.chat) {
                         this.accountForm.get('chat')?.patchValue(user.chat);
                    }
                    if (user.llmConfig) {
                         this.accountForm.get('llmConfig')?.patchValue(user.llmConfig);
                    }
                     if (user.functionConfig) {
                         this.accountForm.get('functionConfig')?.patchValue(user.functionConfig);
                    }
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
            // email field is now view-only, removed from form group
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
             if (initialUser.chat) {
                 this.accountForm.get('chat')?.patchValue(initialUser.chat);
            }
            if (initialUser.llmConfig) {
                 this.accountForm.get('llmConfig')?.patchValue(initialUser.llmConfig);
            }
             if (initialUser.functionConfig) {
                 this.accountForm.get('functionConfig')?.patchValue(initialUser.functionConfig);
            }
        }

        // Trigger loading the user profile and LLMs via their services
        this.userService.loadUser();
        this.llmService.loadLlms();
    }

    // Save user profile data
    onSave(): void {
        // Mark all controls as touched to display validation errors
        this.accountForm.markAllAsTouched();

        if (this.accountForm.invalid) {
            this.snackBar.open('Please correct the form errors.', 'Close', { duration: 3000 });
            return;
        }

        // Get raw values including disabled controls if needed,
        // but 'id' and 'email' are not in the form group anymore.
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
        // Exclude 'id' and 'email'.
        const updateUserPayload: UserProfileUpdate = {
            // email is not included in the update payload
            chat: {
                defaultLLM: formValues.chat.defaultLLM,
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
            // Patch only the fields that exist in the form
            this.accountForm.patchValue(currentUser);
             if (currentUser.chat) {
                 this.accountForm.get('chat')?.patchValue(currentUser.chat);
            }
            if (currentUser.llmConfig) {
                 this.accountForm.get('llmConfig')?.patchValue(currentUser.llmConfig);
            }
             if (currentUser.functionConfig) {
                 this.accountForm.get('functionConfig')?.patchValue(currentUser.functionConfig);
            }
            // Optionally reset the form's dirty state
            this.accountForm.markAsPristine();
            this.accountForm.markAsUntouched();
        } else {
            // If no user data is available (e.g., initial load failed), reset to empty or default state
            this.accountForm.reset(); // Or patch with specific initial values matching form structure
        }
    }
}
