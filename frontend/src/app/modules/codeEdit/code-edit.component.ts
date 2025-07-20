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
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
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
		MatTableModule,
		MatCheckboxModule,
		MatTooltipModule,
	],
	templateUrl: './code-edit.component.html',
	styleUrls: ['./code-edit.component.scss'],
})
export class CodeEditComponent implements OnInit {
	readonly codeEditService = inject(CodeEditService);
	private readonly fb = inject(FormBuilder);

	readonly treeState = this.codeEditService.treeState;
	readonly showFilePanels = signal(true);
	readonly selectedFiles = signal<string[]>([]);

	instructionForm: FormGroup<{ instructions: FormControl<string> }>;

	treeControl = new NestedTreeControl<FileSystemNode>((node) => node.children);
	dataSource = new MatTreeNestedDataSource<FileSystemNode>();
	selectionDataSource = new MatTableDataSource<string>();
	displayedColumns: string[] = ['path', 'actions'];

	constructor() {
		this.instructionForm = this.fb.nonNullable.group({
			instructions: ['', Validators.required],
		});

		// Effect to update the file tree when data arrives
		effect(() => {
			const state = this.treeState();
			if (state.status === 'success' && state.data) {
				this.dataSource.data = [state.data];
				this.treeControl.expand(state.data);
			} else {
				this.dataSource.data = [];
			}
		});

		// Effect to update the selection table when selected files change
		effect(() => {
			this.selectionDataSource.data = this.selectedFiles();
		});
	}

	ngOnInit(): void {
		this.codeEditService.getFileSystemTree();
	}

	hasChild = (_: number, node: FileSystemNode): boolean => !!node.children && node.children.length > 0;

	private _getAllFilePaths(node: FileSystemNode): string[] {
		if (!node.children || node.children.length === 0) {
			// It's a file
			return [node.path];
		}
		// It's a directory, collect paths from all children
		return node.children.flatMap((child) => this._getAllFilePaths(child));
	}

	toggleNodeSelection(node: FileSystemNode): void {
		const descendantPaths = this._getAllFilePaths(node);
		const areAllSelected = this.isFileOrAncestorSelected(node);

		this.selectedFiles.update((currentSelection) => {
			const selectionSet = new Set(currentSelection);
			if (areAllSelected) {
				// Remove all descendants from selection
				descendantPaths.forEach((path) => selectionSet.delete(path));
			} else {
				// Add all descendants to selection
				descendantPaths.forEach((path) => selectionSet.add(path));
			}
			return Array.from(selectionSet);
		});
	}

	removeFileFromSelection(filePath: string): void {
		this.selectedFiles.update((files) => files.filter((f) => f !== filePath));
	}

	isFileOrAncestorSelected(node: FileSystemNode): boolean {
		const descendantPaths = this._getAllFilePaths(node);
		if (descendantPaths.length === 0) return false; // Empty directories can't be "selected"
		const selected = this.selectedFiles();
		return descendantPaths.every((path) => selected.includes(path));
	}

	isIndeterminate(node: FileSystemNode): boolean {
		if (!this.hasChild(0, node)) return false; // Only directories can be indeterminate
		if (this.isFileOrAncestorSelected(node)) return false; // Not indeterminate if fully selected

		const descendantPaths = this._getAllFilePaths(node);
		const selected = this.selectedFiles();
		return descendantPaths.some((path) => selected.includes(path));
	}

	@HostListener('keydown.control.f', ['$event'])
	@HostListener('keydown.meta.f', ['$event'])
	toggleFilePanels(event: KeyboardEvent): void {
		event.preventDefault();
		this.showFilePanels.update((v) => !v);
	}

	onSubmit(): void {
		if (this.instructionForm.invalid) return;
		const instructions = this.instructionForm.value.instructions;
		console.log('Submitted instructions:', instructions);
		console.log('Selected files:', this.selectedFiles());
		// Future: Call a service to process the instructions
	}
}
