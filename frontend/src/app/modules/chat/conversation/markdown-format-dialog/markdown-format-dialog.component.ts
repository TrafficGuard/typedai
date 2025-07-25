import { ChangeDetectionStrategy, Component, ElementRef, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule, MatSelectionList } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';
import { map, startWith, tap } from 'rxjs/operators';

// A list of common languages for markdown code blocks.
const MARKDOWN_LANGUAGES = [
    'typescript', 'javascript', 'html', 'css', 'scss', 'json', 'yaml', 'markdown',
    'python', 'java', 'csharp', 'go', 'rust', 'ruby', 'php', 'bash', 'shell', 'sql'
].sort();

@Component({
    selector: 'markdown-format-dialog',
    templateUrl: './markdown-format-dialog.component.html',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        MatListModule,
        MatButtonModule,
        MatIconModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownFormatDialogComponent {
    private readonly dialogRef = inject(MatDialogRef<MarkdownFormatDialogComponent>);

    @ViewChild('filterInput') filterInput: ElementRef<HTMLInputElement>;
    @ViewChild('languageList') languageList: MatSelectionList;

    filterControl = new FormControl('');
    filteredLanguages$: Observable<string[]>;

    private lastFilteredLanguages: string[] = [];

    constructor() {
        this.filteredLanguages$ = this.filterControl.valueChanges.pipe(
            startWith(''),
            map(searchText => this._filter(searchText || '')),
            tap(filtered => (this.lastFilteredLanguages = filtered)),
        );
    }

    private _filter(value: string): string[] {
        const filterValue = value.toLowerCase();
        return MARKDOWN_LANGUAGES.filter(lang => lang.toLowerCase().includes(filterValue));
    }

    onEnterKey(event: KeyboardEvent): void {
        if (this.lastFilteredLanguages.length === 1) {
            event.preventDefault();
            this.onLanguageSelected(this.lastFilteredLanguages[0]);
        }
    }

    focusList(): void {
        if (this.languageList?.options.first) {
            this.languageList.options.first.focus();
        }
    }

    focusFilter(event: KeyboardEvent): void {
        if (this.languageList?.options.first) {
            event.preventDefault();
            this.filterInput.nativeElement.focus();
        }
    }

    onLanguageSelected(language: string): void {
        this.dialogRef.close(language);
    }

    onCancel(): void {
        this.dialogRef.close();
    }
}
