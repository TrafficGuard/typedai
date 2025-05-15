/*
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SelectionModel } from '@angular/cdk/collections';
import { CodeReviewListComponent } from './code-review-list.component';
import { CodeReviewServiceClient } from '../code-review.service';
import { CodeReviewConfig } from '#shared/model/codeReview.model';
import { FuseConfirmationService } from '@fuse/services/confirmation'; // For confirmation dialog

// Mock Data
const mockConfigs: CodeReviewConfig[] = [
  { id: '1', title: 'Config 1', enabled: true, description: 'Desc 1', fileExtensions: { include: ['.ts'] }, requires: { text: ['TODO'] }, tags: ['tag1'], projectPaths: ['/proj1'], examples: [] },
  { id: '2', title: 'Config 2', enabled: false, description: 'Desc 2', fileExtensions: { include: ['.js'] }, requires: { text: ['FIXME'] }, tags: ['tag2'], projectPaths: ['/proj2'], examples: [] },
];

describe('CodeReviewListComponent', () => {
  let component: CodeReviewListComponent;
  let fixture: ComponentFixture<CodeReviewListComponent>;
  let mockCodeReviewService: jasmine.SpyObj<CodeReviewServiceClient>;
  let mockRouter: jasmine.SpyObj<Router>;
  // let mockMatDialog: jasmine.SpyObj<MatDialog>; // Replaced by FuseConfirmationService
  let mockMatSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockFuseConfirmationService: jasmine.SpyObj<FuseConfirmationService>;


  beforeEach(async () => {
    mockCodeReviewService = jasmine.createSpyObj('CodeReviewServiceClient', ['getCodeReviewConfigs', 'deleteCodeReviewConfig', 'deleteCodeReviewConfigs']);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    // mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockMatSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    mockFuseConfirmationService = jasmine.createSpyObj('FuseConfirmationService', ['open']);


    await TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        NoopAnimationsModule,
        MatTableModule,
        MatPaginatorModule,
        MatSortModule,
        MatCheckboxModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        CodeReviewListComponent // Standalone component
      ],
      providers: [
        { provide: CodeReviewServiceClient, useValue: mockCodeReviewService },
        { provide: Router, useValue: mockRouter },
        // { provide: MatDialog, useValue: mockMatDialog }, // Replaced
        { provide: MatSnackBar, useValue: mockMatSnackBar },
        { provide: FuseConfirmationService, useValue: mockFuseConfirmationService }
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CodeReviewListComponent);
    component = fixture.componentInstance;

    // Initialize MatTableDataSource for the component as it's done in ngOnInit
    component.configs$ = new MatTableDataSource<CodeReviewConfig>();
  });

  it('should create', () => {
    fixture.detectChanges(); // ngOnInit will run here
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should load configs on init and set up datasource', fakeAsync(() => {
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([...mockConfigs]));
      fixture.detectChanges();
      tick();

      expect(mockCodeReviewService.getCodeReviewConfigs).toHaveBeenCalled();
      expect(component.configs$.data.length).toBe(mockConfigs.length);
      expect(component.isLoading).toBeFalse();
      expect(component.selection.isEmpty()).toBeTrue();
    }));

    it('should handle error when loading configs', fakeAsync(() => {
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(throwError(() => new Error('Failed to load')));
      fixture.detectChanges();
      tick();

      expect(component.isLoading).toBeFalse();
      expect(mockMatSnackBar.open).toHaveBeenCalledWith('Error loading configurations: Failed to load', 'Close', jasmine.any(Object));
    }));
  });

  describe('ngAfterViewInit', () => {
    it('should assign paginator and sort to datasource', fakeAsync(() => {
        mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([...mockConfigs]));
        fixture.detectChanges();
        tick();

        component.paginator = jasmine.createSpyObj('MatPaginator', ['length']);
        component.sort = jasmine.createSpyObj('MatSort', ['sortChange']);

        component.ngAfterViewInit();
        fixture.detectChanges();

        expect(component.configs$.paginator).toBe(component.paginator);
        expect(component.configs$.sort).toBe(component.sort);
    }));
  });


  describe('Selection Handling', () => {
    beforeEach(fakeAsync(() => {
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([...mockConfigs]));
      fixture.detectChanges();
      tick();
    }));

    it('isAllSelected should return true if all rows are selected', () => {
      if (component.configs$.data.length > 0) {
        component.selection.select(...component.configs$.data);
        expect(component.isAllSelected()).toBeTrue();
      } else {
        expect(component.isAllSelected()).toBeFalse();
      }
    });

    it('isAllSelected should return false if not all rows are selected', () => {
      if (component.configs$.data.length > 0) {
        component.selection.select(component.configs$.data[0]);
        expect(component.isAllSelected()).toBeFalse();
      } else {
        expect(component.isAllSelected()).toBeFalse();
      }
    });

    it('isAllSelected should return false if no rows are selected', () => {
      expect(component.isAllSelected()).toBeFalse();
    });

    it('isAllSelected should return false if dataSource is empty', () => {
      component.configs$.data = [];
      fixture.detectChanges();
      expect(component.isAllSelected()).toBeFalse();
    });

    it('masterToggle should select all if none selected and data exists', () => {
      if (component.configs$.data.length > 0) {
        component.masterToggle();
        expect(component.selection.selected.length).toBe(component.configs$.data.length);
      } else {
         component.masterToggle();
         expect(component.selection.isEmpty()).toBeTrue();
      }
    });

    it('masterToggle should clear selection if all selected and data exists', () => {
      if (component.configs$.data.length > 0) {
        component.selection.select(...component.configs$.data);
        component.masterToggle();
        expect(component.selection.isEmpty()).toBeTrue();
      }
    });

    it('masterToggle should select all if some are selected and data exists', () => {
      if (component.configs$.data.length > 0) {
        component.selection.select(component.configs$.data[0]);
        component.masterToggle();
        expect(component.selection.selected.length).toBe(component.configs$.data.length);
      }
    });
  });

  describe('Navigation', () => {
    it('navigateToEdit should navigate to edit page', () => {
      component.navigateToEdit('test-id');
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/code-review/edit', 'test-id']);
    });

    it('navigateToNew should navigate to new config page', () => {
      component.navigateToNew();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/code-review/new']);
    });
  });

  describe('Delete Operations', () => {
     beforeEach(fakeAsync(() => {
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([...mockConfigs]));
      fixture.detectChanges();
      tick();
    }));

    it('deleteSelectedConfigs should do nothing if no configs selected', () => {
      component.deleteSelectedConfigs();
      expect(mockFuseConfirmationService.open).not.toHaveBeenCalled();
    });

    it('deleteSelectedConfigs should open confirmation dialog and delete on confirm', fakeAsync(() => {
      if (mockConfigs.length < 2) { pending('Need at least 2 mock configs for this test'); return; }
      component.selection.select(mockConfigs[0], mockConfigs[1]);
      const selectedIds = [mockConfigs[0].id, mockConfigs[1].id];
      mockFuseConfirmationService.open.and.returnValue({afterClosed: () => of('confirmed')} as MatDialogRef<any>);
      mockCodeReviewService.deleteCodeReviewConfigs.and.returnValue(of(void 0));
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([]));

      component.deleteSelectedConfigs();
      tick();

      expect(mockFuseConfirmationService.open).toHaveBeenCalled();
      expect(mockCodeReviewService.deleteCodeReviewConfigs).toHaveBeenCalledWith(selectedIds);
      expect(mockMatSnackBar.open).toHaveBeenCalledWith('Selected configurations deleted successfully.', 'Close', jasmine.any(Object));
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

    it('deleteSelectedConfigs should handle error during deletion', fakeAsync(() => {
      if (mockConfigs.length === 0) { pending('Need mock configs for this test'); return; }
      component.selection.select(mockConfigs[0]);
      mockFuseConfirmationService.open.and.returnValue({afterClosed: () => of('confirmed')} as MatDialogRef<any>);
      mockCodeReviewService.deleteCodeReviewConfigs.and.returnValue(throwError(() => new Error('Delete failed')));

      component.deleteSelectedConfigs();
      tick();

      expect(mockCodeReviewService.deleteCodeReviewConfigs).toHaveBeenCalled();
      expect(mockMatSnackBar.open).toHaveBeenCalledWith('Error deleting configurations: Delete failed', 'Close', jasmine.any(Object));
    }));
  });

  describe('trackByFn', () => {
    it('should return item id for trackBy', () => {
        const item = { id: 'testId123' } as CodeReviewConfig;
        expect(component.trackByFn(0, item)).toBe('testId123');
    });
  });

  describe('Filtering', () => {
    beforeEach(fakeAsync(() => {
      mockCodeReviewService.getCodeReviewConfigs.and.returnValue(of([...mockConfigs]));
      fixture.detectChanges();
      tick();
    }));

    it('should filter data when applyFilter is called', () => {
      const filterValue = 'Config 1';
      const event = { target: { value: filterValue } } as unknown as Event;
      component.applyFilter(event);
      expect(component.configs$.filter).toBe(filterValue.trim().toLowerCase());
    });
  });
});
*/
