import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { TextFieldModule } from '@angular/cdk/text-field'; // For cdkTextareaAutosize

export interface DialogData {
  reason: string;
}

@Component({
  selector: 'app-vibe-edit-reason-dialog', // Changed selector to be more standard
  templateUrl: './vibe-edit-reason-dialog.component.html',
  styleUrls: ['./vibe-edit-reason-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TextFieldModule
  ],
})
export class VibeEditReasonDialogComponent implements OnInit {
  reasonText: string = '';

  constructor(
    public dialogRef: MatDialogRef<VibeEditReasonDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { reason: string }
  ) {}

  ngOnInit(): void {
    this.reasonText = this.data.reason || '';
  }

  onSave(): void {
    this.dialogRef.close(this.reasonText.trim());
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
