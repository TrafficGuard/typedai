import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { signal, WritableSignal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { MatIconTestingModule } from '@angular/material/icon/testing';

import { CodeEditComponent } from './code-edit.component';
import { CodeEditPo } from './code-edit.component.po';
import { CodeEditService } from './code-edit.service';
import { ChatServiceClient } from '../chat/chat.service';
import { FileSystemNode } from '#shared/files/fileSystemService';
import type { ApiState } from 'app/core/api-state.types';
import { FilesContentResponse } from '#shared/codeEdit/codeEdit.api';

// --- Mock Data ---
const MOCK_FILE_SYSTEM_NODE: FileSystemNode = {
	name: 'root',
	path: 'root',
	type: 'directory',
	children: [
		{
			name: 'src',
			path: 'root/src',
			type: 'directory',
			children: [
				{ name: 'main.ts', path: 'root/src/main.ts', type: 'file', children: [] },
				{ name: 'styles.scss', path: 'root/src/styles.scss', type: 'file', children: [] },
			],
		},
		{ name: 'package.json', path: 'root/package.json', type: 'file', children: [] },
	],
};

// --- Fake Services ---
class FakeCodeEditService {
	treeState: WritableSignal<ApiState<FileSystemNode>> = signal({ status: 'idle' });
	getFileSystemTree = jasmine.createSpy('getFileSystemTree');
	getFilesContent = jasmine.createSpy('getFilesContent');
}

describe('CodeEditComponent', () => {
	let component: CodeEditComponent;
	let fixture: ComponentFixture<CodeEditComponent>;
	let po: CodeEditPo;
	let fakeCodeEditService: FakeCodeEditService;
	let fakeChatService: jasmine.SpyObj<ChatServiceClient>;
	let routerSpy: jasmine.SpyObj<Router>;

	beforeEach(async () => {
		fakeCodeEditService = new FakeCodeEditService();
		fakeChatService = jasmine.createSpyObj('ChatServiceClient', ['createChat']);
		routerSpy = jasmine.createSpyObj('Router', ['navigate']);

		await TestBed.configureTestingModule({
			imports: [CodeEditComponent, NoopAnimationsModule, MatIconTestingModule],
			providers: [
				{ provide: CodeEditService, useValue: fakeCodeEditService },
				{ provide: ChatServiceClient, useValue: fakeChatService },
				{ provide: Router, useValue: routerSpy },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(CodeEditComponent);
		component = fixture.componentInstance;
		po = await CodeEditPo.create(fixture);
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	it('should call getFileSystemTree on initialization', () => {
		// THEN
		expect(fakeCodeEditService.getFileSystemTree).toHaveBeenCalled();
	});

	it('should display a spinner while the file tree is loading', async () => {
		// GIVEN
		fakeCodeEditService.treeState.set({ status: 'loading' });
		await po.detectAndWait();

		// THEN
		expect(await po.isLoadingFileTree()).toBeTrue();
	});

	it('should display an error message if loading the file tree fails', async () => {
		// GIVEN
		fakeCodeEditService.treeState.set({ status: 'error', error: new Error('API Down') });
		await po.detectAndWait();

		// THEN
		expect(await po.getFileTreeError()).toContain('Error loading file tree');
	});

	it('should add all descendant files to selection when a directory checkbox is clicked', async () => {
		// GIVEN
		fakeCodeEditService.treeState.set({ status: 'success', data: MOCK_FILE_SYSTEM_NODE });
		await po.detectAndWait();

		// WHEN
		await po.toggleNodeSelection('root/src');

		// THEN
		const selectedPaths = await po.getSelectedFilePathsFromTable();
		expect(selectedPaths.sort()).toEqual(['root/src/main.ts', 'root/src/styles.scss'].sort());
		expect(await po.getSelectionCount()).toBe(2);
		expect(await po.isNodeSelected('root/src')).toBeTrue();
		expect(await po.isNodeSelected('root/src/main.ts')).toBeTrue();
	});

	it('should show an indeterminate state for a directory with partially selected children', async () => {
		// GIVEN
		fakeCodeEditService.treeState.set({ status: 'success', data: MOCK_FILE_SYSTEM_NODE });
		await po.detectAndWait();

		// WHEN
		await po.toggleNodeSelection('root/src/main.ts');

		// THEN
		expect(await po.isNodeIndeterminate('root/src')).toBeTrue();
		expect(await po.isNodeSelected('root/src')).toBeFalse();
	});

	it('should remove a file from selection via the selection table', async () => {
		// GIVEN
		fakeCodeEditService.treeState.set({ status: 'success', data: MOCK_FILE_SYSTEM_NODE });
		component.selectedFiles.set(['root/package.json']);
		await po.detectAndWait();
		expect(await po.getSelectionCount()).toBe(1);

		// WHEN
		await po.removeFileFromSelection('root/package.json');

		// THEN
		expect(await po.getSelectionCount()).toBe(0);
		expect(await po.isNodeSelected('root/package.json')).toBeFalse();
	});

	it('should show an error if form is submitted with no files selected', async () => {
		// GIVEN
		await po.setInstructions('Do something');

		// WHEN
		await po.clickSubmit();

		// THEN
		expect(await po.getSubmissionError()).toBe('Please select at least one file.');
		expect(fakeCodeEditService.getFilesContent).not.toHaveBeenCalled();
	});
});
