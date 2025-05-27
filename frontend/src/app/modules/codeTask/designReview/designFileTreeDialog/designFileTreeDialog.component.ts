import { Component, Inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatTreeModule, MatTreeNestedDataSource } from '@angular/material/tree';
import { NestedTreeControl } from '@angular/cdk/tree';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { SelectionModel } from '@angular/cdk/collections';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { Subject } from 'rxjs';
import { debounceTime, startWith, takeUntil } from 'rxjs/operators';
import {FileSystemNode} from "#shared/services/fileSystemService";

@Component({
  selector: 'app-codeTask-file-tree-select-dialog',
  templateUrl: './designFileTreeDialog.component.html',
  // styleUrls: ['./codeTask-file-tree-select-dialog.component.scss'], // Create if custom styles are added
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTreeModule,
    MatIconModule,
    MatButtonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
  ],
})
export class DesignFileTreeDialogComponent implements OnInit, OnDestroy {
  treeControl = new NestedTreeControl<FileSystemNode>(node => node.children);
  dataSource = new MatTreeNestedDataSource<FileSystemNode>();
  filterControl = new FormControl('');
  originalDataSourceData: FileSystemNode[] = [];
  // SelectionModel to track selected file paths (strings)
  selection = new SelectionModel<string>(true /* multiple */);
  private destroy$ = new Subject<void>();

  constructor(
    public dialogRef: MatDialogRef<DesignFileTreeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { rootNode: FileSystemNode | null },
  ) {}

  ngOnInit(): void {
    if (this.data.rootNode) {
      let initialData: FileSystemNode[];
      if (Array.isArray(this.data.rootNode)) {
        initialData = this.data.rootNode;
      } else if (this.data.rootNode.children && Array.isArray(this.data.rootNode.children)) {
        initialData = this.data.rootNode.children;
      } else {
        initialData = [this.data.rootNode];
      }
      // Store a deep copy for unfiltered state. JSON stringify/parse is a simple way for complex objects.
      this.originalDataSourceData = JSON.parse(JSON.stringify(initialData));
      this.dataSource.data = initialData; // Initial display
    } else {
      this.originalDataSourceData = [];
      this.dataSource.data = [];
    }

    this.filterControl.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      takeUntil(this.destroy$)
    ).subscribe(value => {
      this._filterTree(value || '');
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  hasChild = (_: number, node: FileSystemNode): boolean => !!node.children && node.children.length > 0;

  getNodeIcon(node: FileSystemNode): string {
    return node.type === 'directory' ? 'folder' : 'insert_drive_file';
  }

  onCancelClick(): void {
    this.dialogRef.close();
  }

  onSelectClick(): void {
    // Return the array of selected file paths
    this.dialogRef.close(this.selection.selected);
  }

  /** Checks if a node is a file. */
  isFile(node: FileSystemNode): boolean {
    return node.type === 'file';
  }

  /** Toggles the selection of a file node. */
  toggleFileSelection(node: FileSystemNode): void {
    if (this.isFile(node)) {
      this.selection.toggle(node.path); // node.path should be the unique file path string
    }
  }

  /** Checks if a file node is selected. */
  isFileSelected(node: FileSystemNode): boolean {
    return this.isFile(node) && this.selection.isSelected(node.path);
  }

  private _doesNodeNameMatch(nodeName: string, searchTerm: string): boolean {
    if (!searchTerm) { // If searchTerm is empty, consider it a match to show all nodes under normal circumstances, but for filtering, an empty search term means no filter applied by this specific function. The _filterTree handles empty overall filter.
        return true; // Let _filterTree handle the "show all" case when filterText is empty.
    }
    const normalizedNodeName = nodeName.toLowerCase();

    // Check if the whole node name starts with the search term
    if (normalizedNodeName.startsWith(searchTerm)) {
        return true;
    }

    // Split the node name by common separators (dot, dash, underscore)
    // and check if any part starts with the search term.
    const nameParts = normalizedNodeName.split(/[.\-_]/); // Note: escaped dot for regex
    if (nameParts.some(part => part.startsWith(searchTerm))) {
        return true;
    }

    // Add check for camelCase parts:
    // Split by uppercase letters to get camelCase parts, then check if any part starts with the search term.
    // e.g., "MyComponentFile" -> "my", "component", "file" (after lowercasing and splitting)
    // This regex splits before uppercase letters, then filter out empty strings from split.
    const camelCaseProcessedParts = normalizedNodeName.replace(/([A-Z])/g, ' $1').toLowerCase().split(' ').filter(part => part.length > 0);
    if (camelCaseProcessedParts.some(part => part.startsWith(searchTerm))) {
        return true;
    }

    return false;
  }

  private _filterNodeRecursive(node: FileSystemNode, filterText: string): FileSystemNode | null {
    const directMatch = this._doesNodeNameMatch(node.name, filterText);

    if (node.type === 'directory') {
      const filteredChildren = node.children
        ?.map(child => this._filterNodeRecursive(child, filterText))
        .filter(child => child !== null) as FileSystemNode[] | undefined;

      if (filteredChildren && filteredChildren.length > 0) {
        // If children match, return the node with its filtered children
        return { ...node, children: filteredChildren };
      }
      // If no children match, but the directory name itself matches, return it (with no children shown in filtered view)
      if (directMatch) {
        return { ...node, children: [] }; // Show the directory itself if its name matches
      }
    } else { // It's a file
      if (directMatch) {
        return { ...node }; // Return the file if its name matches
      }
    }
    return null; // No match for this node or its children
  }

  private _filterTree(filterText: string): void {
    const normalizedFilter = filterText.toLowerCase().trim();
    if (!normalizedFilter) {
      this.dataSource.data = JSON.parse(JSON.stringify(this.originalDataSourceData)); // Reset to full tree
      return;
    }

    const filteredData = this.originalDataSourceData
      .map(node => this._filterNodeRecursive(node, normalizedFilter))
      .filter(node => node !== null) as FileSystemNode[];

    this.dataSource.data = filteredData;

    if (filteredData.length > 0 && normalizedFilter) {
       this.treeControl.expandAll(); // Simple approach: expand everything in the filtered tree
    }
  }
}
