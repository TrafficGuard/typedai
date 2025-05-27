import { TextFieldModule } from '@angular/cdk/text-field';
import { NgClass } from '@angular/common';
import {Component, OnInit, ViewEncapsulation, computed, DestroyRef, inject} from '@angular/core';
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
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { LlmService } from "../../../llm.service";
import { UserService } from 'app/core/user/user.service'; // Added import
import { finalize, filter } from "rxjs"; // Removed map from here as it's not used directly by component anymore
// HttpClient import removed as it's not used
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { AgentService } from '../../agent.service';
import {MatCard, MatCardContent} from "@angular/material/card";
import {AutonomousSubType} from "#shared/model/agent.model";
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';

const defaultSubType: AutonomousSubType = 'codegen';

@Component({
  selector: 'new-autonomous-agent',
  templateUrl: './new-autonomous-agent.component.html',
  styleUrls: ['./new-autonomous-agent.component.scss'],
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
    ],
})
export class NewAutonomousAgentComponent implements OnInit {
  private functionsError = computed(() => {
    const state = this.agentService.availableFunctionsState();
    return state.status === 'error' ? state.error : null;
  });

  functions = computed(() => {
    const state = this.agentService.availableFunctionsState();
    if (state.status === 'success') {
      return state.data;
    }
    return [];
  });

  llms = computed(() => {
    const state = this.llmService.llmsState();
    return state.status === 'success' ? state.data : [];
  });

  runAgentForm: FormGroup;
  isSubmitting = false;
  private destroyRef = inject(DestroyRef);

  constructor(
      private snackBar: MatSnackBar,
      private router: Router,
      // private agentEventService: AgentEventService,
      private llmService: LlmService,
      private userService: UserService, // Added UserService
      private agentService: AgentService
  ) {
    this.runAgentForm = new FormGroup({
      name: new FormControl('', Validators.required),
      userPrompt: new FormControl('', Validators.required),
      subtype: new FormControl(defaultSubType, Validators.required),
      llmEasy: new FormControl('', Validators.required),
      llmMedium: new FormControl('', Validators.required),
      llmHard: new FormControl('', Validators.required),
      budget: new FormControl(0, [Validators.required, Validators.min(0)]),
      count: new FormControl(0, [Validators.required, Validators.min(0), Validators.pattern('^[0-9]*$')]),
      useSharedRepos: new FormControl(true),
    });

    toObservable(this.functions).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(functions => {
      console.log('NewAutonomousAgentComponent: received functions from service state', functions);

      // Dynamically add form controls for each function if they don't exist
      functions.forEach((tool, index) => {
        const controlName = 'function' + index;
        if (!(this.runAgentForm as FormGroup).get(controlName)) {
          (this.runAgentForm as FormGroup).addControl(controlName, new FormControl(false));
        }
      });

      // Initial check for shared repos state after functions and controls are set up
      this.updateSharedReposState();
    });

    toObservable(this.functionsError).pipe(
      filter(error => error !== null),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(error => {
      console.error('Error fetching agent functions from service state', error);
      this.snackBar.open('Error fetching agent functions', 'Close', { duration: 3000 });
    });

    toObservable(this.userService.userProfile).pipe(
      filter(userProfile => userProfile !== null),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(userProfile => {
      if (userProfile) {
        this.runAgentForm.patchValue({
          budget: userProfile.hilBudget,
          count: userProfile.hilCount,
        });
      }
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
      openai: { easy: 'openai:gpt-4o-mini', medium: 'openai:o4-mini', hard: 'openai:o3' },
    };
    const selection = presets[preset];
    if (selection) {
      const ids = this.llms().map((llm) => llm.id);
      this.runAgentForm.controls['llmEasy'].setValue(ids.find((id) => id.startsWith(selection.easy)));
      this.runAgentForm.controls['llmMedium'].setValue(ids.find((id) => id.startsWith(selection.medium)));
      this.runAgentForm.controls['llmHard'].setValue(ids.find((id) => id.startsWith(selection.hard)));
    }
    return false;
  }

  ngOnInit(): void {
    this.agentService.loadAvailableFunctions();
    this.llmService.loadLlms();

    // Subscribe to form value changes to update shared repos state dynamically
    // This should be set up once after the form is initialized.
    this.runAgentForm.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
            this.updateSharedReposState();
        });
  }

  private updateSharedReposState(): void {
    const sharedReposControl = this.runAgentForm.get('useSharedRepos');
    if (!sharedReposControl) {
      return; // Exit if control doesn't exist yet
    }

    let gitFunctionSelected = false;
    for (let i = 0; i < this.functions().length; i++) {
      const functionName = this.functions()[i];
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
    const selectedFunctions: string[] = this.functions()
        .filter((_, index) => this.runAgentForm.value['function' + index])
        .map((tool, _) => tool);

    const payload = {
      agentName: this.runAgentForm.value.name,
      initialPrompt: this.runAgentForm.value.userPrompt,
      type: 'autonomous' as const,
      subtype: this.runAgentForm.value.subtype,
      functions: selectedFunctions,
      humanInLoop: {
        budget: this.runAgentForm.value.budget,
        count: this.runAgentForm.value.count,
      },
      llms: {
        easy: this.runAgentForm.value.llmEasy,
        medium: this.runAgentForm.value.llmMedium,
        hard: this.runAgentForm.value.llmHard,
      },
      useSharedRepos: this.runAgentForm.value.useSharedRepos,
    };

    this.agentService.startAgent(payload)
        .pipe(finalize(() => this.isSubmitting = false))
        .subscribe({
          next: (response) => { // response is AgentContextApi
            this.snackBar.open('Agent started', 'Close', { duration: 3000 });
            // AgentContextApi (from AGENT_API.start response) has agentId directly.
            this.router.navigate(['/ui/agents', response.agentId]).catch(console.error);
          },
          error: (error) => {
            const errorMessage = error?.message || 'Failed to start agent';
            this.snackBar.open(`Error: ${errorMessage}`, 'Close', { duration: 3000 });
            console.error('Error starting agent via service', error);
          },
        });
  }
}
