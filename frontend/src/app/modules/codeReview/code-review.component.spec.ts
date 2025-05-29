import { CommonModule } from '@angular/common';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { CodeReviewComponent } from './code-review.component';

describe('CodeReviewComponent', () => {
	let component: CodeReviewComponent;
	let fixture: ComponentFixture<CodeReviewComponent>;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [
				CodeReviewComponent, // Import the standalone component
				CommonModule,
				RouterTestingModule,
			],
		}).compileComponents();

		fixture = TestBed.createComponent(CodeReviewComponent);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});
});
