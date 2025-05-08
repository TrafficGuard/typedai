import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms'; // Add ReactiveFormsModule, FormControl
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatSelectModule } from '@angular/material/select'; // Add MatSelectModule

import type { SelectedFile } from './vibe.types'; // Add this import

export interface VibeEditReasonDialogData {
    reason: string;
    filePath?: string;
    currentCategory?: SelectedFile['category'];
    availableCategories?: Array<SelectedFile['category']>;
}

@Component({
  selector: 'app-vibe-edit-reason-dialog', // Changed selector to be more standard
  templateUrl: './vibe-edit-reason-dialog.component.html',
  styleUrls: ['./vibe-edit-reason-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule, // Add this
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TextFieldModule,
    MatSelectModule // Add this
  ],
})
export class VibeEditReasonDialogComponent implements OnInit {
  reasonText: string = '';
  public categoryControl = new FormControl<SelectedFile['category'] | ''>(''); // Add this line

  constructor(
    public dialogRef: MatDialogRef<VibeEditReasonDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VibeEditReasonDialogData // Update this line
  ) {}

  ngOnInit(): void {
    this.reasonText = this.data.reason || '';
    if (this.data.availableCategories && this.data.availableCategories.length > 0) {
      this.categoryControl.setValue(this.data.currentCategory || 'unknown');
    }
  }

  onSave(): void {
    const selectedCategory = (this.data.availableCategories && this.data.availableCategories.length > 0
                             ? this.categoryControl.value
                             : 'unknown') || 'unknown';
    this.dialogRef.close({
      reason: this.reasonText.trim(),
      category: selectedCategory
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
