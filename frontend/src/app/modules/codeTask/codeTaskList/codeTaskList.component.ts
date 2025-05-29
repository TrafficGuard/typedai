import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, ViewEncapsulation, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import type { CodeTask } from '#shared/codeTask/codeTask.model';
import { CodeTaskServiceClient } from '../codeTask.service';

@Component({
	selector: 'codeTaskList',
	templateUrl: './codeTaskList.component.html',
	styleUrls: ['./codeTaskList.component.scss'],
	encapsulation: ViewEncapsulation.None,
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [CommonModule, MatButtonModule, MatIconModule, MatTableModule, MatTooltipModule],
})
export class CodeTaskListComponent implements OnInit {
	displayedColumns: string[] = ['title', 'status', 'createdAt', 'actions'];

	private codeTaskService = inject(CodeTaskServiceClient);
	private router = inject(Router);

	readonly codeTasksState = this.codeTaskService.codeTasksState;

	readonly isLoading = computed(() => this.codeTasksState().status === 'loading');

	readonly codeTasks$ = this.codeTaskService.codeTasks$;

	ngOnInit(): void {
		this.loadCodeTasks();
	}

	loadCodeTasks(): void {
		this.codeTaskService.loadCodeTasks();
	}

	createNewCodeTask(): void {
		this.router.navigate(['/ui/codeTask/new']);
	}

	viewCodeTask(codeTaskId: string): void {
		this.router.navigate(['/ui/codeTask', codeTaskId]);
	}

	refreshCodeTasks(): void {
		this.codeTaskService.loadCodeTasks();
	}

	trackByCodeTaskId(index: number, item: CodeTask): string {
		return item.id;
	}
}
