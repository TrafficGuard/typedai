import { CommonModule } from '@angular/common';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { CodeReviewComponent } from './code-review.component';
import { CodeReviewPo } from './code-review.component.po';

describe('CodeReviewComponent', () => {
	let component: CodeReviewComponent;
	let fixture: ComponentFixture<CodeReviewComponent>;
	let po: CodeReviewPo;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [
				CodeReviewComponent, // Import the standalone component
				CommonModule,
				RouterTestingModule,
				NoopAnimationsModule, // Recommended for Material components
			],
			// providers: [ /* Mock services here if needed */ ]
		}).compileComponents();

		fixture = TestBed.createComponent(CodeReviewComponent);
		component = fixture.componentInstance;
		// It's important to call detectChanges before creating the PO
		// so that the view is initialized.
		fixture.detectChanges();
		po = await CodeReviewPo.create(fixture);
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	// Example test using the Page Object
	// This test assumes 'create-review-button' exists in code-review.component.html
	it('should have a create review button visible', async () => {
		// Arrange: Check if the button exists using a PO helper (if one was created for existence)
		// For this example, we'll directly use the click method which would fail if not found.
		// A more robust test might check for existence first if the element can be optional.
		// e.g. expect(await po.isCreateReviewButtonPresent()).toBe(true);

		// Act & Assert: For demonstration, we are not clicking but checking its presence via a harness.
		// This is a basic check. A real behavioral test would click and verify outcomes.
		try {
			const button = await po.loader.getHarness(MatButtonHarness.with({ selector: `[data-testid="create-review-button"]` }));
			expect(button).toBeTruthy();
		} catch (e) {
			// Fail the test if the button is not found
			fail('Create review button with data-testid="create-review-button" was not found.');
		}
	});

	it('should allow typing in search input', async () => {
		// This test assumes 'search-input' exists
		const searchText = 'My Review';
		await po.setSearchText(searchText);
		await po.detectAndWait(); // Ensure UI updates after typing

		const inputValue = await po.getSearchInputValue();
		expect(inputValue).toBe(searchText);
	});
});
