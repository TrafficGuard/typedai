import {Component, OnInit, inject, signal, computed, ChangeDetectionStrategy} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  FormArray,
  AbstractControl,
  ValidationErrors,
  ReactiveFormsModule
} from '@angular/forms';
import {ActivatedRoute, Router} from '@angular/router';
import {CodeReviewServiceClient} from '../code-review.service';
import {MatChipInputEvent, MatChipsModule} from '@angular/material/chips';
import {CommonModule, Location} from "@angular/common";
import {MatButtonModule} from "@angular/material/button";
import {MatFormFieldModule} from "@angular/material/form-field";
import {MatIconModule} from "@angular/material/icon";
import {MatInputModule} from "@angular/material/input";
import {MatCard, MatCardContent} from "@angular/material/card";
import {MatCheckbox} from "@angular/material/checkbox";
import {MatProgressSpinnerModule} from "@angular/material/progress-spinner";
import {Observable} from "rxjs";
import {CodeReviewConfigCreate, CodeReviewConfigUpdate, MessageResponse} from "#shared/schemas/codeReview.schema";
import {IExample} from "#shared/model/codeReview.model";

@Component({
  selector: 'app-code-review-edit',
  templateUrl: './code-review-edit.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatChipsModule,
    MatIconModule,
    MatInputModule,
    MatCard,
    MatCardContent,
    MatCheckbox,
    MatProgressSpinnerModule,
  ],
})
export class CodeReviewEditComponent implements OnInit {
  private fb = inject(FormBuilder);
  private codeReviewService = inject(CodeReviewServiceClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  editForm = signal<FormGroup>(this.initForm());
  isLoading = signal<boolean>(false);
  isSaving = signal<boolean>(false);
  error = signal<string | null>(null);
  configId = signal<string | null>(null);
  pageTitle = computed(() => this.configId() ? 'Edit Code Review Configuration' : 'Create Code Review Configuration');

  constructor() {}

  ngOnInit() {
    this.configId.set(this.route.snapshot.paramMap.get('id'));
    console.log(this.configId());
    if (this.configId()) {
      this.loadConfigData();
    }
    // No need to call addExample() here if the form starts empty or with one example by default from initForm
  }

  initForm(): FormGroup {
    return this.fb.group({
      title: ['', Validators.required],
      enabled: [true],
      description: ['', Validators.required],
      fileExtensions: this.fb.group({
        include: [[], [Validators.required, this.arrayNotEmpty]],
      }),
      requires: this.fb.group({
        text: [[], [Validators.required, this.arrayNotEmpty]],
      }),
      tags: [[]],
      projectPaths: [[]],
      examples: this.fb.array([], [Validators.required, this.arrayNotEmpty]),
    });
  }

  arrayNotEmpty(control: AbstractControl): ValidationErrors | null {
    const array = control.value as any[];
    return array && array.length > 0 ? null : { required: true };
  }

  loadConfigData() {
    if (!this.configId()) return;
    this.isLoading.set(true);
    this.error.set(null);
    this.codeReviewService.getCodeReviewConfig(this.configId()!).subscribe({
      next: (response) => {
        const data = response;
        this.editForm().patchValue(data);

        const examplesArray = this.editForm().get('examples') as FormArray;
        while (examplesArray.length !== 0) {
          examplesArray.removeAt(0);
        }

        if (data.examples && Array.isArray(data.examples)) {
          data.examples.forEach((example: IExample) => {
            examplesArray.push(
              this.fb.group({
                code: [example.code, Validators.required],
                reviewComment: [example.reviewComment, Validators.required],
              })
            );
          });
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.error.set('Error loading config data');
        this.isLoading.set(false);
      }
    });
  }

  onSubmit() {
    console.log('Submit clicked. Form validity:', this.editForm().valid);
    console.log('Form value:', this.editForm().value);
    if (this.editForm().invalid) {
      this.editForm().markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    this.error.set(null);
    const formData = this.editForm().value;
    let saveObservable: Observable<MessageResponse>;

    if (this.configId()) {
      saveObservable = this.codeReviewService.updateCodeReviewConfig(this.configId()!, formData as CodeReviewConfigUpdate);
    } else {
      saveObservable = this.codeReviewService.createCodeReviewConfig(formData as CodeReviewConfigCreate);
    }

    saveObservable.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.router.navigate(['/ui/code-reviews']).catch(console.error);
      },
      error: (err) => {
        console.error(err);
        this.error.set('Error saving configuration');
        this.isSaving.set(false);
      }
    });
  }

  get examples() {
    return this.editForm().get('examples') as FormArray;
  }

  addExample() {
    this.examples.push(
      this.fb.group({
        code: ['', Validators.required],
        reviewComment: ['', Validators.required],
      })
    );
  }

  removeExample(index: number) {
    this.examples.removeAt(index);
  }

  goBack(): void {
    this.location.back();
  }

  removeExtension(ext: string) {
    const include = this.editForm().get('fileExtensions.include');
    const currentExtensions = (include?.value as string[]) || [];
    const updatedExtensions = currentExtensions.filter((e) => e !== ext);
    include?.setValue(updatedExtensions);
    include?.updateValueAndValidity();
  }

  addExtension(event: MatChipInputEvent) {
    const input = event.input;
    const value = event.value;

    if ((value || '').trim()) {
      const include = this.editForm().get('fileExtensions.include');
      const currentExtensions = (include?.value as string[]) || [];
      if (!currentExtensions.includes(value.trim())) {
        include?.setValue([...currentExtensions, value.trim()]);
        include?.updateValueAndValidity();
      }
    }

    if (input) {
      input.value = '';
    }
  }

  removeRequiredText(text: string) {
    const requiredText = this.editForm().get('requires.text');
    const currentTexts = (requiredText?.value as string[]) || [];
    requiredText?.setValue(currentTexts.filter((t) => t !== text));
    requiredText?.updateValueAndValidity();
  }

  addRequiredText(event: MatChipInputEvent) {
    const input = event.input;
    const value = event.value;

    if ((value || '').trim()) {
      const requiredText = this.editForm().get('requires.text');
      const currentTexts = (requiredText?.value as string[]) || [];
      if (!currentTexts.includes(value.trim())) {
        requiredText?.setValue([...currentTexts, value.trim()]);
        requiredText?.updateValueAndValidity();
      }
    }

    if (input) {
      input.value = '';
    }
  }

  removeTag(tag: string) {
    const tags = this.editForm().get('tags');
    const currentTags = (tags?.value as string[]) || [];
    tags?.setValue(currentTags.filter((t) => t !== tag));
    tags?.updateValueAndValidity();
  }

  addTag(event: MatChipInputEvent) {
    const input = event.input;
    const value = event.value;

    if ((value || '').trim()) {
      const tags = this.editForm().get('tags');
      const currentTags = (tags?.value as string[]) || [];
      if (!currentTags.includes(value.trim())) {
        tags?.setValue([...currentTags, value.trim()]);
        tags?.updateValueAndValidity();
      }
    }

    if (input) {
      input.value = '';
    }
  }

  removeProjectPath(path: string) {
    const projectPaths = this.editForm().get('projectPaths');
    const currentPaths = (projectPaths?.value as string[]) || [];
    projectPaths?.setValue(currentPaths.filter((p) => p !== path));
    projectPaths?.updateValueAndValidity();
  }

  addProjectPath(event: MatChipInputEvent) {
    const input = event.input;
    const value = event.value;

    if ((value || '').trim()) {
      const projectPaths = this.editForm().get('projectPaths');
      const currentPaths = (projectPaths?.value as string[]) || [];
      if (!currentPaths.includes(value.trim())) {
        projectPaths?.setValue([...currentPaths, value.trim()]);
        projectPaths?.updateValueAndValidity();
      }
    }

    if (input) {
      input.value = '';
    }
  }
}
