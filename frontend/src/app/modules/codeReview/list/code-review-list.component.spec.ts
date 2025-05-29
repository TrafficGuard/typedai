import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule } from '@angular/common';

import { CodeReviewListComponent } from './code-review-list.component';
import { CodeReviewServiceClient } from '../code-review.service';
import { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { MessageResponse, CodeReviewConfigListResponse } from '#shared/codeReview/codeReview.schema';

// Mock Data
const mockConfigs: CodeReviewConfig[] = [
  { id: '1', title: 'Config 1', enabled: true, description: 'Desc 1', fileExtensions: { include: ['.ts'] }, requires: { text: ['TODO'] }, tags: ['tag1'], projectPaths: ['/proj1'], examples: [] },
  { id: '2', title: 'Config 2', enabled: false, description: 'Desc 2', fileExtensions: { include: ['.js'] }, requires: { text: ['FIXME'] }, tags: ['tag2'], projectPaths: ['/proj2'], examples: [] },
];

const mockMessageResponse: MessageResponse = { message: 'Success' };

describe('CodeReviewListComponent', () => {
  let component: CodeReviewListComponent;
  let fixture: ComponentFixture<CodeReviewListComponent>;
  let mockCodeReviewService: jasmine.SpyObj<CodeReviewServiceClient>;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockMatSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockFuseConfirmationService: jasmine.SpyObj<FuseConfirmationService>;


  beforeEach(async () => {
    mockCodeReviewService = jasmine.createSpyObj('CodeReviewServiceClient', ['getCodeReviewConfigs', 'deleteCodeReviewConfigs']);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockMatSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    mockFuseConfirmationService = jasmine.createSpyObj('FuseConfirmationService', ['open']);


    await TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        NoopAnimationsModule,
        CommonModule,
        MatTableModule,
        MatCheckboxModule,
        MatButtonModule,
        MatIconModule,
        MatProgressBarModule,
        MatProgressSpinnerModule,
        CodeReviewListComponent // Standalone component
      ],
      providers: [
        { provide: CodeReviewServiceClient, useValue: mockCodeReviewService },
        { provide: Router, useValue: mockRouter },
        { provide: MatSnackBar, useValue: mockMatSnackBar },
        { provide: FuseConfirmationService, useValue: mockFuseConfirmationService }
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CodeReviewListComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges(); // ngOnInit will run here
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should load configs on init', fakeAsync(() => {
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([...mockConfigs] as CodeReviewConfigListResponse));
      fixture.detectChanges(); // Calls ngOnInit
      tick(); // Complete asynchronous operations

      expect(mockCodeReviewService.getCodeReviewConfigs).toHaveBeenCalled();
      expect(component.configs().length).toBe(mockConfigs.length);
      expect(component.isLoading()).toBeFalse();
      expect(component.errorMessage()).toBe('');
      expect(component.selection.isEmpty()).toBeTrue();
    }));

    it('should handle error when loading configs', fakeAsync(() => {
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(throwError(() => new Error('Failed to load')));
      fixture.detectChanges(); // Calls ngOnInit
      tick(); // Complete asynchronous operations

      expect(component.isLoading()).toBeFalse();
      expect(component.errorMessage()).toBe('Error loading configurations');
    }));
  });

  describe('Selection Handling', () => {
    beforeEach(fakeAsync(() => {
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([...mockConfigs] as CodeReviewConfigListResponse));
      fixture.detectChanges();
      tick();
    }));

    it('isAllSelected should return true if all rows are selected and there are rows', () => {
      component.configs.set([...mockConfigs]);
      fixture.detectChanges();
      if (component.configs().length > 0) {
        component.selection.select(...component.configs());
        expect(component.isAllSelected()).toBeTrue();
      } else {
        expect(component.isAllSelected()).toBeFalse(); // Or handle as per desired logic for no rows
      }
    });

    it('isAllSelected should return false if not all rows are selected', () => {
      component.configs.set([...mockConfigs]);
      fixture.detectChanges();
      if (component.configs().length > 1) {
        component.selection.select(component.configs()[0]);
        expect(component.isAllSelected()).toBeFalse();
      } else {
        // If only one row, selecting it means all are selected.
        // If no rows, it's false.
        expect(component.isAllSelected()).toBe(component.configs().length === 1 && component.selection.hasValue());
      }
    });

    it('isAllSelected should return false if no rows are selected', () => {
      component.configs.set([...mockConfigs]);
      fixture.detectChanges();
      expect(component.isAllSelected()).toBeFalse(); // Initially no selection
    });

    it('isAllSelected should return false if configs signal is empty', () => {
      component.configs.set([]);
      fixture.detectChanges();
      expect(component.isAllSelected()).toBeFalse();
    });

    it('masterToggle should select all if none selected and data exists', () => {
      component.configs.set([...mockConfigs]);
      fixture.detectChanges();
      if (component.configs().length > 0) {
        component.masterToggle();
        expect(component.selection.selected.length).toBe(component.configs().length);
      } else {
         component.masterToggle();
         expect(component.selection.isEmpty()).toBeTrue();
      }
    });

    it('masterToggle should clear selection if all selected and data exists', () => {
      component.configs.set([...mockConfigs]);
      fixture.detectChanges();
      if (component.configs().length > 0) {
        component.selection.select(...component.configs());
        component.masterToggle();
        expect(component.selection.isEmpty()).toBeTrue();
      }
    });

    it('masterToggle should select all if some are selected and data exists', () => {
      component.configs.set([...mockConfigs]);
      fixture.detectChanges();
      if (component.configs().length > 0) {
        component.selection.select(component.configs()[0]);
        component.masterToggle(); // This will select all because not all were selected
        expect(component.selection.selected.length).toBe(component.configs().length);
      }
    });
  });

  describe('Navigation', () => {
    it('openEditPage should navigate to edit page with id', () => {
      component.openEditPage('test-id');
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/code-reviews/edit', 'test-id'], jasmine.any(Object));
    });

    it('openEditPage should navigate to new config page without id', () => {
      component.openEditPage();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/code-reviews/new'], jasmine.any(Object));
    });
  });

  describe('Delete Operations', () => {
     beforeEach(fakeAsync(() => {
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([...mockConfigs] as CodeReviewConfigListResponse));
      fixture.detectChanges();
      tick();
    }));

    it('deleteSelectedConfigs should show snackbar and not open dialog if no configs selected', () => {
      component.deleteSelectedConfigs();
      expect(mockMatSnackBar.open).toHaveBeenCalledWith('No configurations selected for deletion', 'Close', { duration: 3000 });
      expect(mockFuseConfirmationService.open).not.toHaveBeenCalled();
    });

    it('deleteSelectedConfigs should open confirmation dialog and delete on confirm', fakeAsync(() => {
      if (mockConfigs.length < 1) { pending('Need at least 1 mock config for this test'); return; }
      component.selection.select(mockConfigs[0]);
      const selectedIds = [mockConfigs[0].id];
      mockFuseConfirmationService.open.and.returnValue({afterClosed: () => of('confirmed')} as MatDialogRef<any>);
      mockCodeReviewService.deleteCodeReviewConfigs.and.returnValue(of(mockMessageResponse));
      // Mock the getCodeReviewConfigs call that happens after successful deletion
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([] as CodeReviewConfigListResponse));

      component.deleteSelectedConfigs();
      tick();

      expect(mockFuseConfirmationService.open).toHaveBeenCalled();
      expect(mockCodeReviewService.deleteCodeReviewConfigs).toHaveBeenCalledWith(selectedIds);
      expect(mockMatSnackBar.open).toHaveBeenCalledWith('Configurations deleted successfully', 'Close', { duration: 3000 });
      // Called once during setup, once after delete
      expect(mockCodeReviewService.getCodeReviewConfigs).toHaveBeenCalledTimes(2);
      expect(component.selection.isEmpty()).toBeTrue();
    }));

    it('deleteSelectedConfigs should not delete if dialog is cancelled', fakeAsync(() => {
      if (mockConfigs.length === 0) { pending('Need mock configs for this test'); return; }
      component.selection.select(mockConfigs[0]);
      mockFuseConfirmationService.open.and.returnValue({afterClosed: () => of('cancelled')} as MatDialogRef<any>);

      component.deleteSelectedConfigs();
      tick();

      expect(mockFuseConfirmationService.open).toHaveBeenCalled();
      expect(mockCodeReviewService.deleteCodeReviewConfigs).not.toHaveBeenCalled();
    }));

    it('deleteSelectedConfigs should handle error during deletion and show snackbar', fakeAsync(() => {
      if (mockConfigs.length === 0) { pending('Need mock configs for this test'); return; }
      component.selection.select(mockConfigs[0]);
      mockFuseConfirmationService.open.and.returnValue({afterClosed: () => of('confirmed')} as MatDialogRef<any>);
      mockCodeReviewService.deleteCodeReviewConfigs.and.returnValue(throwError(() => new Error('Delete failed')));

      component.deleteSelectedConfigs();
      tick();

      expect(mockCodeReviewService.deleteCodeReviewConfigs).toHaveBeenCalled();
      expect(mockMatSnackBar.open).toHaveBeenCalledWith('Error deleting configurations', 'Close', { duration: 3000 });
      expect(component.errorMessage()).toBe('Error deleting configurations');
    }));
  });

  describe('refreshConfigs', () => {
    it('should call loadConfigs and show snackbar', fakeAsync(() => {
        spyOn(component, 'loadConfigs'); // Spy on the actual method
        component.refreshConfigs();
        tick();

        expect(component.loadConfigs).toHaveBeenCalled();
        expect(mockMatSnackBar.open).toHaveBeenCalledWith('Configurations refreshed', 'Close', { duration: 1000 });
    }));
  });
});
