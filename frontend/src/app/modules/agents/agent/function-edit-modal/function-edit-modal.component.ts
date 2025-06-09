import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';

@Component({
	selector: 'app-function-edit-modal',
	templateUrl: './function-edit-modal.component.html',
	styleUrls: ['./function-edit-modal.component.scss'],
	standalone: true,
	imports: [CommonModule, FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatListModule, MatIconModule],
})
export class FunctionEditModalComponent {
	allFunctions: string[];
	selectedFunctions: string[];
	searchTerm = '';

	constructor(
		private dialogRef: MatDialogRef<FunctionEditModalComponent>,
		@Inject(MAT_DIALOG_DATA) data: { functions: string[]; allFunctions: string[] },
	) {
		console.log('Received data:', data);
		this.allFunctions = (data.allFunctions || []).sort();
		this.selectedFunctions = [...(data.functions || [])].sort();
		console.log('Initialized allFunctions:', this.allFunctions);
		console.log('Initialized selectedFunctions:', this.selectedFunctions);
	}

	filterFunctions(): string[] {
		if (!this.searchTerm) {
			return this.allFunctions;
		}
		const searchTerms = this.searchTerm.toLowerCase().split(/\s+/);
		return this.allFunctions.filter((func) => searchTerms.every((term) => func.toLowerCase().includes(term)));
	}

	toggleFunction(func: string): void {
		const index = this.selectedFunctions.indexOf(func);
		if (index > -1) {
			this.selectedFunctions.splice(index, 1);
		} else {
			this.selectedFunctions.push(func);
			this.selectedFunctions.sort();
		}
		console.log('Updated selectedFunctions:', this.selectedFunctions);
	}

	onSave(): void {
		console.log('Saving selectedFunctions:', this.selectedFunctions);
		this.dialogRef.close(this.selectedFunctions);
	}

	onCancel(): void {
		this.dialogRef.close();
	}
}
