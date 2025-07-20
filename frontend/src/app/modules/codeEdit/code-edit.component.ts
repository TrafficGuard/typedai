import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AngularSplitModule } from 'angular-split';
import { CodeEditService } from './code-edit.service';

@Component({
    selector: 'app-code-edit',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, AngularSplitModule],
    templateUrl: './code-edit.component.html',
    styleUrls: ['./code-edit.component.scss'],
})
export class CodeEditComponent implements OnInit {
    private readonly codeEditService = inject(CodeEditService);
    private readonly fb = inject(FormBuilder);

    readonly treeState = this.codeEditService.treeState;
    readonly showFilePanels = signal(true);

    instructionForm: FormGroup<{ instructions: FormControl<string> }>;

    constructor() {
        this.instructionForm = this.fb.nonNullable.group({
            instructions: ['', Validators.required],
        });
    }

    ngOnInit(): void {
        this.codeEditService.getFileSystemTree();
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
        // Future: Call a service to process the instructions
    }
}
