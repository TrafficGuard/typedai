import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatSelectModule } from '@angular/material/select';
import { SelectedFile } from "#shared/files/files.model";

export interface FileEditReasonDialogData {
    reason: string;
    filePath?: string;
    currentCategory?: SelectedFile['category'];
    availableCategories?: Array<SelectedFile['category']>;
}

@Component({
  selector: 'app-fileSelectionEditDialog',
  templateUrl: './fileSelectionEditDialog.component.html',
  styleUrls: ['./fileSelectionEditDialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TextFieldModule,
    MatSelectModule
  ],
})
export class FileSelectionEditDialogComponent implements OnInit {
  reasonText: string = '';
  public categoryControl = new FormControl<SelectedFile['category'] | ''>('');

  constructor(
    public dialogRef: MatDialogRef<FileSelectionEditDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: FileEditReasonDialogData
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
