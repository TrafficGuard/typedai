import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

export interface DialogData {
  reason: string;
}

@Component({
  selector: 'vibe-edit-reason-dialog',
  template: `
    <h1 mat-dialog-title>Edit Reason</h1>
    <div mat-dialog-content>
      <mat-form-field class="w-full">
        <mat-label>Reason</mat-label>
        <textarea matInput [(ngModel)]="data.reason" cdkTextareaAutosize cdkAutosizeMinRows="3" cdkAutosizeMaxRows="5"></textarea>
      </mat-form-field>
    </div>
    <div mat-dialog-actions align="end">
      <button mat-button (click)="onNoClick()">Cancel</button>
      <button mat-flat-button color="primary" [mat-dialog-close]="data.reason" cdkFocusInitial>Save</button>
    </div>
  `,
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
})
export class VibeEditReasonDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<VibeEditReasonDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData,
  ) {}

  onNoClick(): void {
    this.dialogRef.close();
  }
}
