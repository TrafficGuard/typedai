import { TextFieldModule } from '@angular/cdk/text-field';
import { CommonModule } from '@angular/common';
import { Component, Inject, type OnInit } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, type MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { SelectedFile } from '#shared/files/files.model';

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
	imports: [CommonModule, FormsModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, TextFieldModule, MatSelectModule],
})
export class FileSelectionEditDialogComponent implements OnInit {
	reasonText = '';
	public categoryControl = new FormControl<SelectedFile['category'] | ''>('');

	constructor(
		public dialogRef: MatDialogRef<FileSelectionEditDialogComponent>,
		@Inject(MAT_DIALOG_DATA) public data: FileEditReasonDialogData,
	) {}

	ngOnInit(): void {
		this.reasonText = this.data.reason || '';
		if (this.data.availableCategories && this.data.availableCategories.length > 0) {
			this.categoryControl.setValue(this.data.currentCategory || 'unknown');
		}
	}

	onSave(): void {
		const selectedCategory = (this.data.availableCategories && this.data.availableCategories.length > 0 ? this.categoryControl.value : 'unknown') || 'unknown';
		this.dialogRef.close({
			reason: this.reasonText.trim(),
			category: selectedCategory,
		});
	}

	onCancel(): void {
		this.dialogRef.close();
	}
}
