import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { LandingHomeComponent } from './home.component';

describe('LandingHomeComponent', () => {
	let component: LandingHomeComponent;
	let fixture: ComponentFixture<LandingHomeComponent>;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [
				LandingHomeComponent,
				RouterTestingModule,
				NoopAnimationsModule,
				MatIconTestingModule
			],
		}).compileComponents();

		fixture = TestBed.createComponent(LandingHomeComponent);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});
});
