import { TextFieldModule } from '@angular/cdk/text-field';
import { NgClass } from '@angular/common';
import {Component, OnInit, ViewEncapsulation} from '@angular/core';
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
import { map } from "rxjs";
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
  selector: 'new-agent',
  templateUrl: './new-agent.component.html',
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
export class NewAgentComponent implements OnInit {
  functions: string[] = [];
  llms: any[] = [];
  runAgentForm: FormGroup;
  isSubmitting = false;

  constructor(
      private http: HttpClient,
      private snackBar: MatSnackBar,
      private router: Router,
      // private agentEventService: AgentEventService,
      private llmService: LlmService
  ) {
    this.runAgentForm = new FormGroup({
      name: new FormControl('', Validators.required),
      userPrompt: new FormControl('', Validators.required),
      type: new FormControl(defaultType, Validators.required),
      llmEasy: new FormControl('', Validators.required),
      llmMedium: new FormControl('', Validators.required),
      llmHard: new FormControl('', Validators.required),
      budget: new FormControl(0, [Validators.required, Validators.min(0)]),
      count: new FormControl(0, [Validators.required, Validators.min(0), Validators.pattern('^[0-9]*$')]),
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
      gemini: { easy: 'vertex:gemini-2.0-flash', medium: 'vertex:gemini-2.5-pro', hard: 'vertex:gemini-2.5-pro' },
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

  private loadUserProfile(): void {
    const profileUrl = `/api/profile/view`;
    this.http.get(profileUrl).subscribe(
        (response: any) => {
          console.log(response.data);
          this.runAgentForm.controls['budget'].setValue(response.data.hilBudget);
          this.runAgentForm.controls['count'].setValue(response.data.hilCount);
        },
        (error) => {
          console.log(error);
          this.snackBar.open('Failed to load user profile', 'Close', { duration: 3000 });
        }
    );
  }

  // ... rest of the component
  onSubmit(): void {
    if (!this.runAgentForm.valid) return;
    // Implement the logic to handle form submission
    console.log('Form submitted', this.runAgentForm.value);
    const selectedFunctions: string[] = this.functions
        .filter((_, index) => this.runAgentForm.value['function' + index])
        .map((tool, _) => tool);
    this.http
        .post<StartAgentResponse>(`/api/agent/v1/start`, {
          name: this.runAgentForm.value.name,
          userPrompt: this.runAgentForm.value.userPrompt,
          type: this.runAgentForm.value.type,
          // systemPrompt: this.runAgentForm.value.systemPrompt,
          functions: selectedFunctions,
          budget: this.runAgentForm.value.budget,
          count: this.runAgentForm.value.count,
          llmEasy: this.runAgentForm.value.llmEasy,
          llmMedium: this.runAgentForm.value.llmMedium,
          llmHard: this.runAgentForm.value.llmHard,
        })
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
