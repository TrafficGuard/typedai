import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { CommonModule } from "@angular/common";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatCardModule } from "@angular/material/card";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatInputModule } from '@angular/material/input';
import { WorkflowsService } from "../../workflows/workflows.service";
import {MatIconModule} from "@angular/material/icon";
import {MatButtonModule} from "@angular/material/button";

@Component({
  selector: 'app-new-workflows-agent',
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

  constructor(private fb: FormBuilder, private workflowsService: WorkflowsService) {}

  ngOnInit() {
    this.codeForm = this.fb.group({
      workingDirectory: ['', Validators.required],
      workflowType: ['code', Validators.required],
      input: ['', Validators.required],
    });

    this.workflowsService.getRepositories().subscribe({
      next: (repos: string[]) => {
        this.repositories = repos;
        if (repos.length > 0) {
          this.codeForm.patchValue({ workingDirectory: repos[0] });
        }
      },
      error: (error: any) => {
        console.error('Error fetching repositories:', error);
        this.result = 'Error fetching repositories. Please try again later.';
      },
    });
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
