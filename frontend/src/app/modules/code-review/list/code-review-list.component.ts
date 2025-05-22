import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { CodeReviewServiceClient } from '../code-review.service';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { SelectionModel } from '@angular/cdk/collections';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatCheckboxModule } from "@angular/material/checkbox";
// MatToolbarModule is not used in the template, so removing it from component imports
// import { MatToolbarModule } from "@angular/material/toolbar";
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from "@angular/material/progress-bar"; // Import MatProgressBarModule
import { MatTooltipModule } from '@angular/material/tooltip';
import { CodeReviewConfig } from "#shared/model/codeReview.model";
import { CodeReviewConfigListResponse } from '#shared/schemas/codeReview.schema';

@Component({
  selector: 'app-code-review-list',
  templateUrl: './code-review-list.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    // MatToolbarModule, // Not used
    MatTableModule,
    MatProgressSpinnerModule,
    MatProgressBarModule, // Use MatProgressBarModule
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeReviewListComponent implements OnInit {
  private codeReviewService = inject(CodeReviewServiceClient);
  private router = inject(Router);
  private dialog = inject(FuseConfirmationService);
  private snackBar = inject(MatSnackBar);

  configs = signal<CodeReviewConfig[]>([]);
  selection = new SelectionModel<CodeReviewConfig>(true, []);
  displayedColumns = signal<string[]>(['select', 'title', 'description', 'enabled']);
  isLoading = signal(false);
  errorMessage = signal('');

  ngOnInit() {
    this.loadConfigs();
  }

  loadConfigs() {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.codeReviewService.getCodeReviewConfigs().subscribe(
      (response: CodeReviewConfigListResponse) => { // Explicitly type response
        // Assuming response is an object like { data: CodeReviewConfig[] }
        // or response itself could be the array in some cases.
        let configsArray: CodeReviewConfig[] = [];
        if (response && Array.isArray(response)) {
          configsArray = response;
        } else if (Array.isArray(response)) {
          // Fallback if response itself is the array
          configsArray = response;
        }
        this.configs.set(configsArray);
        this.isLoading.set(false);
        this.selection.clear();
      },
      () => {
        this.errorMessage.set('Error loading configurations');
        this.isLoading.set(false);
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
    const numRows = this.configs().length;
    return numRows > 0 && numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected()
      ? this.selection.clear()
      : this.configs().forEach((row) => this.selection.select(row));
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
              this.loadConfigs(); // This will update signals
            },
            () => {
              this.errorMessage.set('Error deleting configurations');
              this.snackBar.open('Error deleting configurations', 'Close', { duration: 3000 });
            }
          );
        }
      });
  }

  refreshConfigs(): void {
    this.loadConfigs(); // This will update signals
    this.snackBar.open('Configurations refreshed', 'Close', { duration: 1000 });
  }
}
