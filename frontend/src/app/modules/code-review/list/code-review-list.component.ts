import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CodeReviewServiceClient } from '../code-review.service';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { MatTableDataSource } from '@angular/material/table';
import { SelectionModel } from '@angular/cdk/collections';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatToolbarModule } from "@angular/material/toolbar";
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBar } from "@angular/material/progress-bar";
import { CodeReviewConfig } from "#shared/model/codeReview.model";

@Component({
  selector: 'app-code-review-list',
  templateUrl: './code-review-list.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatToolbarModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatProgressBar,
  ]
})
export class CodeReviewListComponent implements OnInit {
  configs$: MatTableDataSource<CodeReviewConfig> = new MatTableDataSource<CodeReviewConfig>([]);
  selection = new SelectionModel<CodeReviewConfig>(true, []);
  displayedColumns: string[] = ['select', 'title', 'description', 'enabled'];
  isLoading = false;
  errorMessage = '';

  constructor(
    private codeReviewService: CodeReviewServiceClient,
    private router: Router,
    private dialog: FuseConfirmationService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.loadConfigs();
  }

  loadConfigs() {
    this.isLoading = true;
    this.codeReviewService.getCodeReviewConfigs().subscribe(
      (configs) => {
        this.configs$.data = configs;
        this.isLoading = false;
        this.selection.clear();
      },
      () => {
        this.errorMessage = 'Error loading configurations';
        this.isLoading = false;
      }
    );
  }

  openEditPage(id?: string) {
    if (id) {
      this.router.navigate(['/ui/code-reviews/edit', id]).catch(console.error);
    } else {
      this.router.navigate(['/ui/code-reviews/new']).catch(console.error);
    }
  }

  isAllSelected(): boolean {
    const numSelected = this.selection.selected.length;
    const numRows = this.configs$.data.length;
    return numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected()
      ? this.selection.clear()
      : this.configs$.data.forEach((row) => this.selection.select(row));
  }

  deleteSelectedConfigs(): void {
    const selectedIds = this.selection.selected.map((config) => config.id);
    if (selectedIds.length === 0) {
      this.snackBar.open('No configurations selected for deletion', 'Close', { duration: 3000 });
      return;
    }

    this.dialog
      .open({
        title: 'Confirm Deletion',
        message: `Are you sure you want to delete ${selectedIds.length} configuration(s)?`,
        actions: {
          confirm: {
            show: true,
            label: 'Delete',
            color: 'warn'
          },
          cancel: {
            show: true,
            label: 'Cancel'
          }
        }
      })
      .afterClosed()
      .subscribe((result) => {
        if (result === 'confirmed') {
          this.codeReviewService.deleteCodeReviewConfigs(selectedIds).subscribe(
            () => {
              this.snackBar.open('Configurations deleted successfully', 'Close', { duration: 3000 });
              this.loadConfigs();
            },
            () => {
              this.errorMessage = 'Error deleting configurations';
              this.snackBar.open('Error deleting configurations', 'Close', { duration: 3000 });
            }
          );
        }
      });
  }

  refreshConfigs(): void {
    this.loadConfigs();
    this.snackBar.open('Configurations refreshed', 'Close', { duration: 1000 });
  }
}
