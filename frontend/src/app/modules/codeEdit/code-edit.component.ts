import { Component, HostListener, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AngularSplitModule } from 'angular-split';
import { CodeEditService } from './code-edit.service';
import { NestedTreeControl } from '@angular/cdk/tree';
import { MatTreeModule, MatTreeNestedDataSource } from '@angular/material/tree';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { catchError, finalize, of, switchMap, tap } from 'rxjs';
import { FileSystemNode } from '#shared/files/fileSystemService';

@Component({
	selector: 'app-code-edit',
	standalone: true,
	imports: [
		CommonModule,
		ReactiveFormsModule,
		AngularSplitModule,
		MatTreeModule,
		MatIconModule,
		MatButtonModule,
		MatProgressSpinnerModule,
		MatCheckboxModule,
		MatTableModule,
	],
	templateUrl: './code-edit.component.html',
	styleUrls: ['./code-edit.component.scss'],
})
export class CodeEditComponent implements OnInit {
	readonly codeEditService = inject(CodeEditService);
	private readonly fb = inject(FormBuilder);
	private readonly router = inject(Router);

	readonly treeState = this.codeEditService.treeState;
	readonly showFilePanels = signal(true);
	readonly selectedFiles = signal<string[]>([]);
	readonly submitting = signal(false);
	readonly submissionError = signal<string | null>(null);

	instructionForm: FormGroup<{ instructions: FormControl<string> }>;

	treeControl = new NestedTreeControl<FileSystemNode>((node) => node.children);
	dataSource = new MatTreeNestedDataSource<FileSystemNode>();

	constructor() {
		this.instructionForm = this.fb.nonNullable.group({
			instructions: ['', Validators.required],
		});

		effect(() => {
			const state = this.treeState();
			if (state.status === 'success' && state.data) {
				// The data source expects an array of root nodes.
				this.dataSource.data = [state.data];
				this.treeControl.expand(state.data);
			} else {
				this.dataSource.data = [];
			}
		});
	}

	ngOnInit(): void {
		this.codeEditService.getFileSystemTree();
	}

	hasChild = (_: number, node: FileSystemNode): boolean => !!node.children && node.children.length > 0;

	@HostListener('keydown.control.f', ['$event'])
	@HostListener('keydown.meta.f', ['$event'])
	toggleFilePanels(event: KeyboardEvent): void {
		event.preventDefault();
		this.showFilePanels.update((v) => !v);
	}

	private getAllDescendantFiles(node: FileSystemNode): string[] {
		if (node.type === 'file') {
			return [node.path];
		}
		if (!node.children) {
			return [];
		}
		return node.children.flatMap((child) => this.getAllDescendantFiles(child));
	}

	descendantsAllSelected(node: FileSystemNode): boolean {
		const descendantFiles = this.getAllDescendantFiles(node);
		if (descendantFiles.length === 0) return false;
		return descendantFiles.every((path) => this.selectedFiles().includes(path));
	}

	descendantsPartiallySelected(node: FileSystemNode): boolean {
		const descendantFiles = this.getAllDescendantFiles(node);
		const selectedCount = descendantFiles.filter((path) => this.selectedFiles().includes(path)).length;
		return selectedCount > 0 && selectedCount < descendantFiles.length;
	}

	toggleNodeSelection(node: FileSystemNode): void {
		const descendantFiles = this.getAllDescendantFiles(node);
		const allSelected = this.descendantsAllSelected(node);

		this.selectedFiles.update((currentSelection) => {
			const selectionSet = new Set(currentSelection);
			if (allSelected) {
				descendantFiles.forEach((path) => selectionSet.delete(path));
			} else {
				descendantFiles.forEach((path) => selectionSet.add(path));
			}
			return Array.from(selectionSet);
		});
	}

	removeFileFromSelection(path: string): void {
		this.selectedFiles.update((files) => files.filter((f) => f !== path));
	}

	onSubmit(): void {
		this.submissionError.set(null);
		if (this.instructionForm.invalid) return;
		if (this.selectedFiles().length === 0) {
			this.submissionError.set('Please select at least one file.');
			return;
		}

		this.submitting.set(true);
		const instructions = this.instructionForm.value.instructions as string;
		const files = this.selectedFiles();

		// this.codeEditService.proposeEdits(instructions, files);
	}
}
