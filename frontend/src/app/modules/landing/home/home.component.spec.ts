import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { LandingHomeComponent } from './home.component';

describe('LandingHomeComponent', () => {
    let component: LandingHomeComponent;
    let fixture: ComponentFixture<LandingHomeComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                LandingHomeComponent, // Import the standalone component directly
                RouterTestingModule,
                NoopAnimationsModule, // For Material components
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
