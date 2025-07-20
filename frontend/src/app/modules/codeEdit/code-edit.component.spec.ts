import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { CodeEditComponent } from './code-edit.component';
import { CodeEditService } from './code-edit.service';

describe('CodeEditComponent', () => {
    let component: CodeEditComponent;
    let fixture: ComponentFixture<CodeEditComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [CodeEditComponent, HttpClientTestingModule, NoopAnimationsModule],
            providers: [CodeEditService],
        }).compileComponents();

        fixture = TestBed.createComponent(CodeEditComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
