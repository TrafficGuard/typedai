import { Component, OnInit, effect } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { CommonModule } from "@angular/common";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatCardModule } from "@angular/material/card";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatInputModule } from '@angular/material/input';
import { WorkflowsService } from "./workflows.service";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";

@Component({
  selector: 'new-workflows-agent',
  templateUrl: './new-workflows-agent.component.html',
  styleUrls: ['./new-workflows-agent.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatCardModule,
    MatProgressBarModule,
    MatInputModule,
    MatButtonModule,
  ]
})
export class NewWorkflowsAgentComponent implements OnInit {
  codeForm!: FormGroup;
  result: string = '';
  isLoading = false;
  repositories: string[] = [];

  constructor(private fb: FormBuilder, private workflowsService: WorkflowsService) {
    effect(() => {
      const state = this.workflowsService.repositoriesState();
      switch (state.status) {
        case 'success':
          this.repositories = state.data;
          if (state.data.length > 0) {
            // Ensure form is initialized before patching
            if (this.codeForm) {
              this.codeForm.patchValue({ workingDirectory: state.data[0] });
            }
          }
          // Clear previous error from this source if any, or handle UI updates
          break;
        case 'error':
          console.error('Error fetching repositories:', state.error);
          this.result = `Error fetching repositories: ${state.error.message}. Please try again later.`;
          this.repositories = [];
          break;
        case 'loading':
          // Optionally, indicate loading state for repositories in the UI
          // For example, this.result = 'Loading repositories...';
          break;
        case 'idle':
          this.repositories = [];
          break;
      }
    });
  }

  ngOnInit() {
    this.codeForm = this.fb.group({
      workingDirectory: ['', Validators.required],
      workflowType: ['code', Validators.required],
      input: ['', Validators.required],
    });

    this.workflowsService.loadRepositories();
  }

  getInputLabel(): string {
    const workflowType = this.codeForm.get('workflowType')?.value;
    switch (workflowType) {
      case 'code':
        return 'Requirements';
      case 'query':
        return 'Query';
      case 'selectFiles':
        return 'Requirements for File Selection';
      default:
        return 'Input';
    }
  }

  onSubmit() {
    console.log(`valid ${this.codeForm.valid}`);
    if (this.codeForm.valid) {
      this.isLoading = true;
      this.executeOperation();
    }
  }

  /**
   * Executes the selected operation based on the form input.
   * This method handles different operation types and calls the appropriate service method.
   * It also manages the loading state and error handling for all operations.
   */
  private executeOperation() {
    const { workingDirectory, workflowType, input } = this.codeForm.value;

    let operation: Observable<any>;

    switch (workflowType) {
      case 'code':
        operation = this.workflowsService.runCodeEditorImplementRequirements(workingDirectory, input);
        break;
      case 'query':
        operation = this.workflowsService.runCodebaseQuery(workingDirectory, input);
        break;
      case 'selectFiles':
        operation = this.workflowsService.selectFilesToEdit(workingDirectory, input);
        break;
      default:
        this.result = 'Error: Invalid operation type';
        this.isLoading = false;
        return;
    }

    operation.subscribe({
      next: (response: any) => {
        this.result = workflowType === 'query' ? response.response : JSON.stringify(response, null, 2);
        this.isLoading = false;
      },
      error: (error: Error) => {
        console.error(`Error in ${workflowType} operation:`, error);
        this.result = `Error during ${workflowType} operation: ${error.message}`;
        this.isLoading = false;
      },
    });
  }
}
