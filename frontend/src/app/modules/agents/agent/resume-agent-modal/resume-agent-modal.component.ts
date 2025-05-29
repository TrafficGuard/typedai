import { CommonModule } from '@angular/common';
import { Component, type OnInit } from '@angular/core';
import { type FormBuilder, type FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
	selector: 'app-resume-agent-modal',
	template: `
    <h2 mat-dialog-title class="font-bold">Resume Agent</h2>
    <form [formGroup]="resumeForm" (ngSubmit)="onSubmit()">
      <mat-dialog-content>
        <mat-form-field appearance="fill" style="width: 100%">
          <mat-label>Instructions</mat-label>
          <textarea matInput formControlName="resumeInstructions" rows="4"></textarea>
          <mat-error *ngIf="resumeForm.get('resumeInstructions')?.hasError('required')">
            Resume instructions are required
          </mat-error>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions>
        <button mat-button type="button" (click)="onNoClick()">Cancel</button>
        <button mat-button color="primary" type="submit" [disabled]="!resumeForm.valid" cdkFocusInitial>Resume</button>
      </mat-dialog-actions>
    </form>
  `,
	standalone: true,
	imports: [CommonModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
})
export class ResumeAgentModalComponent implements OnInit {
	resumeForm: FormGroup;

	constructor(
		public dialogRef: MatDialogRef<ResumeAgentModalComponent>,
		private fb: FormBuilder,
	) {
		this.resumeForm = this.fb.group({
			resumeInstructions: ['', Validators.required],
		});
	}

	ngOnInit(): void {}

	onNoClick(): void {
		this.dialogRef.close();
	}

	onSubmit(): void {
		if (this.resumeForm.valid) {
			this.dialogRef.close(this.resumeForm.value);
		}
	}
}
