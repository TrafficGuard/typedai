import { TextFieldModule } from '@angular/cdk/text-field';
import { NgClass } from '@angular/common';
import {Component, OnInit, ViewEncapsulation, OnDestroy, ChangeDetectorRef} from '@angular/core';
import {
  FormControl, FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatOptionModule } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { HttpClient } from "@angular/common/http";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { LlmService } from "../services/llm.service";
import { map, finalize, Subject, takeUntil } from "rxjs";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { MatCheckboxModule } from "@angular/material/checkbox";
import {MatCard, MatCardContent} from "@angular/material/card";

interface StartAgentResponse {
  data: {
    agentId: string;
  };
}

const defaultType/*: AgentType*/ = 'codegen';

@Component({
  selector: 'new-autonomous-agent',
  templateUrl: './new-autonomous-agent.component.html',
  styleUrls: ['./new-agent.component.scss'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
    imports: [
        MatIconModule,
        FormsModule,
        MatFormFieldModule,
        NgClass,
        MatInputModule,
        TextFieldModule,
        ReactiveFormsModule,
        MatButtonToggleModule,
        MatButtonModule,
        MatSelectModule,
        MatOptionModule,
        MatCheckboxModule,
        MatChipsModule,
        MatDatepickerModule,
        MatProgressSpinner,
        MatCard,
        MatCardContent,
    ],
})
export class NewAutonomousAgentComponent implements OnInit, OnDestroy {
  functions: string[] = [];
  llms: any[] = [];
  runAgentForm: FormGroup;
  isSubmitting = false;
  private destroy$ = new Subject<void>();

  constructor(
      private http: HttpClient,
      private snackBar: MatSnackBar,
      private router: Router,
      // private agentEventService: AgentEventService,
      private llmService: LlmService,
      private changeDetectorRef: ChangeDetectorRef
  ) {
    this.runAgentForm = new FormGroup({
      name: new FormControl('', Validators.required),
      userPrompt: new FormControl('', Validators.required),
      subtype: new FormControl(defaultType, Validators.required),
      llmEasy: new FormControl('', Validators.required),
      llmMedium: new FormControl('', Validators.required),
      llmHard: new FormControl('', Validators.required),
      budget: new FormControl(0, [Validators.required, Validators.min(0)]),
      count: new FormControl(0, [Validators.required, Validators.min(0), Validators.pattern('^[0-9]*$')]),
      useSharedRepos: new FormControl(true),
    });
  }
  setPreset(preset: string): boolean {
    console.log(`setPreset ${preset}`);
    const presets = {
      'claude-vertex': {
        easy: 'anthropic-vertex:claude-3-5-haiku',
        medium: 'anthropic-vertex:claude-3-7-sonnet',
        hard: 'anthropic-vertex:claude-3-7-sonnet',
      },
      claude: {
        easy: 'anthropic:claude-3-5-haiku',
        medium: 'anthropic:claude-3-7-sonnet',
        hard: 'anthropic:claude-3-7-sonnet',
      },
      gemini: { easy: 'vertex:gemini-2.0-flash-lite', medium: 'vertex:gemini-2.5-flash', hard: 'vertex:gemini-2.5-pro' },
      openai: { easy: 'openai:gpt-4o-mini', medium: 'openai:o3-mini', hard: 'openai:o3-mini' },
    };
    const selection = presets[preset];
    if (selection) {
      const ids = this.llms.map((llm) => llm.id);
      this.runAgentForm.controls['llmEasy'].setValue(ids.find((id) => id.startsWith(selection.easy)));
      this.runAgentForm.controls['llmMedium'].setValue(ids.find((id) => id.startsWith(selection.medium)));
      this.runAgentForm.controls['llmHard'].setValue(ids.find((id) => id.startsWith(selection.hard)));
    }
    return false;
  }

  ngOnInit(): void {
    this.http
        .get<{ data: string[] }>(`api/agent/v1/functions`)
        .pipe(
            map((response) => {
              console.log(response);
              return (response.data as string[]).filter((name) => name !== 'Agent');
            })
        )
        .subscribe((functions) => {
          this.functions = functions.sort();
          // Dynamically add form controls for each function
          functions.forEach((tool, index) => {
            (this.runAgentForm as FormGroup).addControl('function' + index, new FormControl(false));
          });

          // Initial check for shared repos state
          this.updateSharedReposState();

          // Subscribe to form value changes to update shared repos state dynamically
          this.runAgentForm.valueChanges
              .pipe(takeUntil(this.destroy$))
              .subscribe(() => {
                this.updateSharedReposState();
              });
        });

    this.llmService.getLlms().subscribe({
      next: (llms) => {
        this.llms = llms;
      },
      error: (error) => {
        console.error('Error fetching LLMs:', error);
        this.snackBar.open('Failed to load LLMs', 'Close', { duration: 3000 });
      },
    });

    this.loadUserProfile();
  }

  // TODO this should use the UserService in user.service.ts
  private loadUserProfile(): void {
    const profileUrl = `/api/profile/view`;
    this.http.get(profileUrl).subscribe(
        (response: any) => {
          console.log(response);
          this.runAgentForm.controls['budget'].setValue(response.hilBudget);
          this.runAgentForm.controls['count'].setValue(response.hilCount);
        },
        (error) => {
          console.log(error);
          this.snackBar.open('Failed to load user profile', 'Close', { duration: 3000 });
        }
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private updateSharedReposState(): void {
    const sharedReposControl = this.runAgentForm.get('useSharedRepos');
    if (!sharedReposControl) {
      return; // Exit if control doesn't exist yet
    }

    let gitFunctionSelected = false;
    for (let i = 0; i < this.functions.length; i++) {
      const functionName = this.functions[i];
      const controlName = 'function' + i;
      const functionControl = this.runAgentForm.get(controlName);

      if (functionControl?.value && (functionName === 'GitLab' || functionName === 'GitHub')) {
        gitFunctionSelected = true;
        break; // Found one, no need to check further
      }
    }

    if (gitFunctionSelected) {
      // Enable if it's currently disabled
      if (sharedReposControl.disabled) {
        sharedReposControl.enable({ emitEvent: false }); // Prevent triggering valueChanges again
      }
    } else {
      // Disable and uncheck if it's currently enabled
      if (sharedReposControl.enabled) {
        sharedReposControl.setValue(false, { emitEvent: false }); // Uncheck
        sharedReposControl.disable({ emitEvent: false }); // Disable
      }
    }

    // Optional: Trigger change detection if needed, though Angular often handles it.
    // this.changeDetectorRef.markForCheck();
  }

  onSubmit(): void {
    if (!this.runAgentForm.valid) return;

    this.isSubmitting = true;

    console.log('Form submitted', this.runAgentForm.value);
    const selectedFunctions: string[] = this.functions
        .filter((_, index) => this.runAgentForm.value['function' + index])
        .map((tool, _) => tool);
    this.http
        .post<StartAgentResponse>(`/api/agent/v1/start`, {
          name: this.runAgentForm.value.name,
          userPrompt: this.runAgentForm.value.userPrompt,
          type: 'autonomous',
          subtype: this.runAgentForm.value.subtype,
          // systemPrompt: this.runAgentForm.value.systemPrompt,
          functions: selectedFunctions,
          budget: this.runAgentForm.value.budget,
          count: this.runAgentForm.value.count,
          llmEasy: this.runAgentForm.value.llmEasy,
          llmMedium: this.runAgentForm.value.llmMedium,
          llmHard: this.runAgentForm.value.llmHard,
          useSharedRepos: this.runAgentForm.value.useSharedRepos,
        })
        .pipe(finalize(() => this.isSubmitting = false))
        .subscribe({
          next: (response) => {
            this.snackBar.open('Agent started', 'Close', { duration: 3000 });
            this.router.navigate(['/ui/agents', response.data.agentId]).catch(console.error);
          },
          error: (error) => {
            this.snackBar.open(`Error ${error.message}`, 'Close', { duration: 3000 });
            console.error('Error starting agent', error);
          },
        });
  }
}
