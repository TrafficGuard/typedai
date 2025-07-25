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

	onSubmit(): void {
		if (this.instructionForm.invalid) return;
		const instructions = this.instructionForm.value.instructions;
		console.log('Submitted instructions:', instructions);
		// Future: Call a service to process the instructions
	}
}
