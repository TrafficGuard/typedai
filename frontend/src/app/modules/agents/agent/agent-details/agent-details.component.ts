import { ChangeDetectorRef, Component, Input, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AgentService } from '../../services/agent.service';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, finalize, map, of, throwError } from 'rxjs';
import { environment } from 'environments/environment';
import { AgentContext, AgentRunningState } from '../../agent.types';
import { FunctionEditModalComponent } from '../function-edit-modal/function-edit-modal.component';
import { ResumeAgentModalComponent } from '../resume-agent-modal/resume-agent-modal.component';
import { FunctionsService } from '../../services/function.service';
import { LlmService, LLM } from '../../services/llm.service';
import {MatTooltip} from "@angular/material/tooltip";
import {AgentLinks, GoogleCloudLinks} from "../../services/agent-links";

@Component({
    selector: 'agent-details',
    templateUrl: './agent-details.component.html',
    styleUrl: 'agent-details.component.scss',
    standalone: true,
    imports: [
        CommonModule,
        MatCardModule,
        MatListModule,
        MatButtonModule,
        MatIconModule,
        MatExpansionModule,
        MatFormFieldModule,
        MatInputModule,
        ReactiveFormsModule,
        MatSelectModule,
        MatCheckboxModule,
        MatRadioModule,
        MatTooltip,
    ],
    providers: [AgentService, LlmService]
})
export class AgentDetailsComponent implements OnInit {
    @Input() agentDetails!: AgentContext;
    @Output() refreshRequested = new EventEmitter<void>();

    feedbackForm!: FormGroup;
    hilForm!: FormGroup;
    errorForm!: FormGroup;
    isSubmitting = false;
    isResumingError = false;
    userPromptExpanded = false;
    outputExpanded = false;
    allAvailableFunctions: string[] = []; // Initialize with an empty array or fetch from a service
    llmNameMap: Map<string, string> = new Map();
    isLoadingLlms = false;
    llmLoadError: string | null = null;
    agentLinks: AgentLinks = new GoogleCloudLinks();

    constructor(
        private formBuilder: FormBuilder,
        private snackBar: MatSnackBar,
        private dialog: MatDialog,
        private functionsService: FunctionsService,
        private changeDetectorRef: ChangeDetectorRef,
        private router: Router,
        private agentService: AgentService,
        private llmService: LlmService
    ) {}

    ngOnInit(): void {
        this.feedbackForm = this.formBuilder.group({ feedback: ['', Validators.required] });
        this.hilForm = this.formBuilder.group({  feedback: [''] });
        this.errorForm = this.formBuilder.group({ errorDetails: ['', Validators.required] });
        this.functionsService.getFunctions().subscribe(value => this.allAvailableFunctions = value)
        this.isLoadingLlms = true;
        this.llmService.getLlms().pipe(
            finalize(() => {
                this.isLoadingLlms = false;
                this.changeDetectorRef.markForCheck();
            })
        ).subscribe({
            next: (llms: LLM[]) => {
                this.llmNameMap = new Map(llms.map(llm => [llm.id, llm.name]));
                this.llmLoadError = null;
            },
            error: (error) => {
                console.error('Error loading LLMs:', error);
                this.llmLoadError = 'Failed to load LLM data';
                this.snackBar.open('Error loading LLM data', 'Close', { duration: 3000 });
            }
        });
    }

    refreshAgentDetails(): void {
        this.refreshRequested.emit();
    }

    onSubmitFeedback(): void {
        if (!this.feedbackForm.valid) return;
        const feedback = this.feedbackForm.get('feedback')?.value;
        this.isSubmitting = true;

        this.agentService.submitFeedback(
            this.agentDetails.agentId,
            this.agentDetails.executionId,
            feedback
        ).pipe(
            catchError((error) => {
                console.error('Error submitting feedback:', error);
                this.snackBar.open('Error submitting feedback', 'Close', { duration: 3000 });
                return of(null);
            }),
            finalize(() => {
                this.isSubmitting = false;
            })
        ).subscribe((response) => {
            if (response) {
                this.feedbackForm.reset();
                this.snackBar.open('Feedback submitted successfully', 'Close', { duration: 3000 });
                this.refreshAgentDetails();
            }
        });
    }

    onResumeHil(): void {
        if (!this.hilForm.valid) return;
        this.isSubmitting = true;
        const feedback = this.hilForm.get('feedback')?.value;
        this.agentService.resumeAgent(
            this.agentDetails.agentId,
            this.agentDetails.executionId,
            feedback
        )
            .pipe(
                catchError((error) => {
                    console.error('Error resuming agent:', error);
                    this.snackBar.open('Error resuming agent', 'Close', { duration: 3000 });
                    return of(null);
                }),
                finalize(() => {
                    this.isSubmitting = false;
                })
            )
            .subscribe((response) => {
                if (response) {
                    this.snackBar.open('Agent resumed successfully', 'Close', { duration: 3000 });
                    this.hilForm.reset();
                    this.refreshAgentDetails();
                }
            });
    }

    onResumeError(): void {
        if (!this.errorForm.valid) return;
        this.isResumingError = true;
        const errorDetails = this.errorForm.get('errorDetails')?.value;

        this.agentService.resumeError(
            this.agentDetails.agentId,
            this.agentDetails.executionId,
            errorDetails
        ).pipe(
            catchError((error) => {
                console.error('Error resuming agent:', error);
                this.snackBar.open('Error resuming agent', 'Close', { duration: 3000 });
                return of(null);
            }),
            finalize(() => {
                this.isResumingError = false;
            })
        ).subscribe((response) => {
            if (response) {
                this.snackBar.open('Agent resumed successfully', 'Close', { duration: 3000 });
                this.errorForm.reset();
                this.refreshAgentDetails();
            }
        });
    }

    cancelAgent(): void {
        this.agentService.cancelAgent(
            this.agentDetails.agentId,
            this.agentDetails.executionId,
            'None provided'
        ).pipe(
            catchError((error) => {
                console.error('Error cancelling agent:', error);
                this.snackBar.open('Error cancelling agent', 'Close', { duration: 3000 });
                return of(null);
            })
        ).subscribe((response) => {
            if (response) {
                this.snackBar.open('Agent cancelled successfully', 'Close', { duration: 3000 });
                this.router.navigate(['/ui/agents/list']).catch(console.error);
            }
        });
    }

    displayState(state: AgentRunningState): string {
        switch (state) {
            case 'agent':
                return 'Agent control loop';
            case 'functions':
                return 'Calling functions';
            case 'error':
                return 'Error';
            case 'hil':
                return 'Human-in-the-loop check';
            case 'feedback':
                return 'Agent requested feedback';
            case 'completed':
                return 'Completed';
            default:
                return state;
        }
    }


    traceUrl(agent: AgentContext): string {
        return this.agentLinks.traceUrl(agent);
    }

    logsUrl(agent: AgentContext): string {
        return this.agentLinks.logsUrl(agent);
    }

    databaseUrl(agent: AgentContext): string {
        return this.agentLinks.databaseUrl(agent);
    }

    getLlmName(llmId: string): string {
        if (!llmId) return 'Unknown';

        return this.llmNameMap.get(llmId) || llmId;
    }

    openFunctionEditModal(): void {
        console.log('Opening function edit modal');
        console.log('Current functions:', this.agentDetails.functions);
        console.log('All available functions:', this.allAvailableFunctions);

        const dialogRef = this.dialog.open(FunctionEditModalComponent, {
            width: '400px',
            data: {
                functions: this.agentDetails.functions || [],       // Ensure it's an array
                allFunctions: this.allAvailableFunctions || [],     // Ensure it's an array
            },
        });

        dialogRef.afterClosed().subscribe((result) => {
            if (result) {
                console.log('Dialog closed with result:', result);
                this.saveFunctions(result);
            } else {
                console.log('Dialog closed without result');
            }
        });
    }

    saveFunctions(selectedFunctions: string[]): void {
        this.agentService.updateAgentFunctions(
            this.agentDetails.agentId,
            selectedFunctions
        ).pipe(
            catchError((error) => {
                console.error('Error updating agent functions:', error);
                this.snackBar.open('Error updating agent functions', 'Close', { duration: 3000 });
                return throwError(() => new Error('Error updating agent functions'));
            })
        ).subscribe({
            next: () => {
                this.snackBar.open('Agent functions updated successfully', 'Close', { duration: 3000 });
                this.agentDetails.functions = selectedFunctions;
                this.changeDetectorRef.markForCheck();
            },
        });
    }

    openResumeModal(): void {
        const dialogRef = this.dialog.open(ResumeAgentModalComponent, {
            width: '500px',
        });

        dialogRef.afterClosed().subscribe((result) => {
            if (result) this.resumeCompletedAgent(result.resumeInstructions);
        });
    }

    private resumeCompletedAgent(resumeInstructions: string): void {
        this.isSubmitting = true;
        this.agentService.resumeCompletedAgent(
            this.agentDetails.agentId,
            this.agentDetails.executionId,
            resumeInstructions
        ).pipe(
            catchError((error) => {
                console.error('Error resuming completed agent:', error);
                this.snackBar.open('Error resuming completed agent', 'Close', { duration: 3000 });
                return of(null);
            }),
            finalize(() => {
                this.isSubmitting = false;
            })
        ).subscribe((response) => {
            if (response) {
                this.snackBar.open('Agent resumed successfully', 'Close', { duration: 3000 });
                this.refreshRequested.emit();
            }
        });
    }
}
