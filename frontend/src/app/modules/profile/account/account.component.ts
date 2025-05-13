import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    ViewEncapsulation,
} from '@angular/core';
import { LlmService, LLM } from 'app/modules/agents/services/llm.service';
import { BehaviorSubject } from 'rxjs';
import {
    FormGroup,
    FormControl,
    Validators,
    ReactiveFormsModule,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from "@angular/material/select";
import { CommonModule } from "@angular/common";
import { USER_API } from '#shared/api/user.api';
import { UserProfileUpdate, UserProfile } from "#shared/schemas/user.schema";

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
    accountForm: FormGroup;
    $llms = new BehaviorSubject<LLM[]>([]);

    constructor(
        private http: HttpClient,
        private snackBar: MatSnackBar,
        private llmService: LlmService
    ) {}

    // -- Lifecycle hooks -- --

    ngOnInit(): void {
        this.accountForm = new FormGroup({
            id: new FormControl({ value: '', disabled: true }),
            username: new FormControl(''), // Note: 'username' is not part of UserProfile from API
            email: new FormControl('', [Validators.required, Validators.email]),
            enabled: new FormControl(false),
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

        this.loadUserProfile();

        this.llmService.getLlms().subscribe(
            llms => this.$llms.next(llms),
            error => console.error('Error loading LLMs:', error)
        );
    }

    private loadUserProfile(): void {
        this.http.get<UserProfile>(USER_API.view.pathTemplate).subscribe( // Modified
            (response: UserProfile) => { // Modified
                console.log('User profile data:', response); // Modified
                this.accountForm.patchValue(response); // Modified
            },
            (error) => {
                this.snackBar.open('Failed to load user profile', 'Close', { duration: 3000 });
                console.error(error);
            }
        );
    }

    // Save user profile data
    onSave(): void {
        if (this.accountForm.invalid) {
            // Handle invalid form state
            this.snackBar.open('Please correct the form errors.', 'Close', { duration: 3000 });
            return;
        }

        const formValues = this.accountForm.getRawValue();
        
        // Validate defaultChatLlmId exists in available LLMs
        const defaultLlmId = formValues.chat.defaultLLM;
        if (defaultLlmId) {
            const availableLlms = this.$llms.getValue();
            if (!availableLlms.some(llm => llm.id === defaultLlmId)) {
                this.snackBar.open('Selected default LLM is not available', 'Close', { duration: 3000 });
                return;
            }
        }

        const updateUserPayload: UserProfileUpdate = {
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

        this.http.post<void>(USER_API.update.pathTemplate, updateUserPayload).subscribe(
            () => {
                this.snackBar.open('Profile updated', 'Close', { duration: 3000 });
            },
            (error) => {
                this.snackBar.open('Failed to save profile.', 'Close', { duration: 3000 });
                console.error(error);
            }
        );
    }

    // Optional: Implement a cancel method
    onCancel(): void {
        // this.accountForm.reset(); // Resetting might clear disabled fields like ID.
        // Reloading profile is safer to restore original state.
        this.loadUserProfile();
    }
}
