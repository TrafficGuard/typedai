import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { FunctionEditModalComponent } from './function-edit-modal.component';
import { FunctionEditModalPo } from './function-edit-modal.component.po';

describe('FunctionEditModalComponent', () => {
	let component: FunctionEditModalComponent;
	let fixture: ComponentFixture<FunctionEditModalComponent>;
	let po: FunctionEditModalPo;
	let dialogRefSpy: jasmine.SpyObj<MatDialogRef<FunctionEditModalComponent>>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let mockDialogData: { functions: string[]; allFunctions: string[] };

	const allAvailableFunctions = ['funcA', 'funcB', 'funcC', 'anotherFunc'];

	beforeEach(async () => {
		dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);
		mockDialogData = {
			functions: [], // Initially selected functions
			allFunctions: [...allAvailableFunctions], // All available functions
		};

		await TestBed.configureTestingModule({
			imports: [
				CommonModule,
				FormsModule,
				NoopAnimationsModule,
				MatDialogModule,
				MatFormFieldModule,
				MatInputModule,
				MatListModule,
				MatIconModule,
				MatButtonModule,
				FunctionEditModalComponent, // Import standalone component
			],
			providers: [
				{ provide: MatDialogRef, useValue: dialogRefSpy },
				{ provide: MAT_DIALOG_DATA, useValue: mockDialogData },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(FunctionEditModalComponent);
		component = fixture.componentInstance;
		po = await FunctionEditModalPo.create(fixture); // BaseSpecPo.create handles initial detectChanges
	});

	it('should create', () => {
		expect(component).toBeTruthy();
		expect(po).toBeTruthy();
	});

	describe('Initial Display', () => {
		it('should display all available functions', async () => {
			const displayedFunctions = await po.getDisplayedFunctionNames();
			expect(displayedFunctions.length).toBe(allAvailableFunctions.length);
			expect(displayedFunctions).toEqual(jasmine.arrayWithExactContents(allAvailableFunctions.sort()));
		});

		it('should correctly mark initially selected functions', async () => {
			// Override initial data for this specific test
			mockDialogData.functions = ['funcA', 'funcC'];
			// Re-create component with new data
			fixture = TestBed.createComponent(FunctionEditModalComponent);
			component = fixture.componentInstance;
			po = await FunctionEditModalPo.create(fixture);

			expect(await po.isFunctionSelected('funcA')).toBeTrue();
			expect(await po.isFunctionSelected('funcB')).toBeFalse();
			expect(await po.isFunctionSelected('funcC')).toBeTrue();
			expect(await po.isFunctionSelected('anotherFunc')).toBeFalse();
		});

		it('should display an empty list if no functions are available', async () => {
			mockDialogData.allFunctions = [];
			mockDialogData.functions = [];
			fixture = TestBed.createComponent(FunctionEditModalComponent);
			component = fixture.componentInstance;
			po = await FunctionEditModalPo.create(fixture);

			const displayedFunctions = await po.getDisplayedFunctionNames();
			expect(displayedFunctions.length).toBe(0);
		});
	});

	describe('Search Functionality', () => {
		it('should filter the list of functions based on search term', async () => {
			await po.typeInSearch('funcA');
			let displayedFunctions = await po.getDisplayedFunctionNames();
			expect(displayedFunctions).toEqual(['funcA', 'anotherFunc']); // Both contain 'funcA' or 'anotherFunc'

			await po.typeInSearch('funcB');
			displayedFunctions = await po.getDisplayedFunctionNames();
			expect(displayedFunctions).toEqual(['funcB']);
		});

		it('should be case-insensitive when filtering', async () => {
			await po.typeInSearch('FUNCA');
			const displayedFunctions = await po.getDisplayedFunctionNames();
			// The component's filter is case-insensitive and matches 'funcA' and 'anotherFunc'
			expect(displayedFunctions).toEqual(jasmine.arrayWithExactContents(['funcA', 'anotherFunc']));
		});

		it('should show "no results" message if search yields no functions', async () => {
			await po.typeInSearch('nonExistentFunction');
			const displayedFunctions = await po.getDisplayedFunctionNames();
			expect(displayedFunctions.length).toBe(0);
			expect(await po.getNoResultsMessageText()).toBe('No functions match your search.');
		});

		it('should clear the search term and show all functions when clear button is clicked', async () => {
			await po.typeInSearch('funcA');
			expect(await po.getSearchTerm()).toBe('funcA');
			let displayedFunctions = await po.getDisplayedFunctionNames();
			expect(displayedFunctions.length).toBeLessThan(allAvailableFunctions.length);

			const clearButton = await po.getClearSearchButtonHarness();
			expect(clearButton).toBeTruthy();
			await po.clearSearch();

			expect(await po.getSearchTerm()).toBe('');
			displayedFunctions = await po.getDisplayedFunctionNames();
			expect(displayedFunctions.length).toBe(allAvailableFunctions.length);
			expect(await po.getClearSearchButtonHarness()).toBeNull();
		});
	});

	describe('Function Selection', () => {
		it('should toggle function selection on click', async () => {
			expect(await po.isFunctionSelected('funcA')).toBeFalse();
			await po.clickFunctionByName('funcA');
			expect(await po.isFunctionSelected('funcA')).toBeTrue();
			await po.clickFunctionByName('funcA');
			expect(await po.isFunctionSelected('funcA')).toBeFalse();
		});

		it('should allow multiple functions to be selected', async () => {
			await po.clickFunctionByName('funcA');
			await po.clickFunctionByName('funcC');
			expect(await po.isFunctionSelected('funcA')).toBeTrue();
			expect(await po.isFunctionSelected('funcB')).toBeFalse();
			expect(await po.isFunctionSelected('funcC')).toBeTrue();
		});
	});

	describe('Dialog Actions', () => {
		it('should call dialogRef.close with selected functions on Save', async () => {
			await po.clickFunctionByName('funcA');
			await po.clickFunctionByName('anotherFunc');
			// component.selectedFunctions should be ['funcA', 'anotherFunc'] (sorted)
			// The component sorts them: ['anotherFunc', 'funcA']

			await po.clickSave();
			expect(dialogRefSpy.close).toHaveBeenCalledOnceWith(['anotherFunc', 'funcA']);
		});

		it('should call dialogRef.close with an empty array if no functions are selected on Save', async () => {
			await po.clickSave();
			expect(dialogRefSpy.close).toHaveBeenCalledOnceWith([]);
		});

		it('should call dialogRef.close without arguments on Cancel', async () => {
			await po.clickCancel();
			expect(dialogRefSpy.close).toHaveBeenCalledOnceWith(); // Or .toHaveBeenCalledOnceWith(undefined)
		});

		it('should not be possible to disable the save button', async () => {
			// The save button in this component does not have a disabled state binding
			expect(await po.isSaveButtonDisabled()).toBeFalse();
		});
	});
});
