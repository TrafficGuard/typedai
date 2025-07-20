import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CodeEditComponent } from './code-edit.component';

describe('CodeEditComponent', () => {
  let component: CodeEditComponent;
  let fixture: ComponentFixture<CodeEditComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeEditComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CodeEditComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
