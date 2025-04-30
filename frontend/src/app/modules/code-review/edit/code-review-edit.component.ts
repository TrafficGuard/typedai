import { Component, OnInit } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  FormArray,
  AbstractControl,
  ValidationErrors,
  ReactiveFormsModule
} from '@angular/forms';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {CodeReviewService} from '../code-review.service';
import {MatChipInputEvent, MatChipsModule} from '@angular/material/chips';
import {CommonModule} from "@angular/common";
import {MatSnackBarModule} from "@angular/material/snack-bar";
import {MatButtonModule} from "@angular/material/button";
import {MatFormFieldModule} from "@angular/material/form-field";
import {MatIconModule} from "@angular/material/icon";
import {MatInputModule} from "@angular/material/input";
import {MatCard, MatCardContent} from "@angular/material/card";
import {MatCheckbox} from "@angular/material/checkbox";

@Component({
  selector: 'app-code-review-edit',
  templateUrl: './code-review-edit.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatSnackBarModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatChipsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCard,
    MatCardContent,
    MatCheckbox,
    RouterLink,
  ],
})
export class CodeReviewEditComponent implements OnInit {
  editForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  configId: string | null = null;

  constructor(
    private fb: FormBuilder,
    private codeReviewService: CodeReviewService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.editForm = this.initForm();
  }

  ngOnInit() {
    this.configId = this.route.snapshot.paramMap.get('id');
    console.log(this.configId);
    if (this.configId) {
      this.loadConfigData();
    } else {
      this.addExample();
    }

    // this.editForm.valueChanges.subscribe(() => {
    //   console.log('Form validity:', this.editForm.valid);
    //   console.log('Form value:', this.editForm.value);
    // });
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
    this.isLoading = true;
    this.codeReviewService.getCodeReviewConfig(this.configId!).subscribe(
      (response) => {
        const data = response.data;
        this.editForm.patchValue(data);

        // Clear existing examples
        while (this.examples.length !== 0) {
          this.examples.removeAt(0);
        }

        // Add examples from the loaded data
        if (data.examples && Array.isArray(data.examples)) {
          data.examples.forEach((example: any) => {
            this.examples.push(
              this.fb.group({
                code: [example.code, Validators.required],
                reviewComment: [example.reviewComment, Validators.required],
              })
            );
          });
        }

        this.isLoading = false;
      },
      (error) => {
        console.error(error);
        this.errorMessage = 'Error loading config data';
        this.isLoading = false;
      }
    );
  }

  onSubmit() {
    console.log('Submit clicked. Form validity:', this.editForm.valid);
    console.log('Form value:', this.editForm.value);
    if (this.editForm.valid) {
      this.isLoading = true;
      const formData = this.editForm.value;
      if (this.configId) {
        this.codeReviewService.updateCodeReviewConfig(this.configId, formData).subscribe(
          () => {
            this.isLoading = false;
            this.router.navigate(['/ui/code-reviews']).catch(console.error);
          },
          (error) => {
            console.error(error);
            this.errorMessage = 'Error updating config';
            this.isLoading = false;
          }
        );
      } else {
        this.codeReviewService.createCodeReviewConfig(formData).subscribe(
          () => {
            this.isLoading = false;
            this.router.navigate(['/ui/code-reviews']).catch(console.error);
          },
          (error) => {
            console.error(error);
            this.errorMessage = 'Error creating config';
            this.isLoading = false;
          }
        );
      }
    }
  }

  get examples() {
    return this.editForm.get('examples') as FormArray;
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

  removeExtension(ext: string) {
    const include = this.editForm.get('fileExtensions.include');
    const currentExtensions = (include?.value as string[]) || [];
    const updatedExtensions = currentExtensions.filter((e) => e !== ext);
    include?.setValue(updatedExtensions);
    include?.updateValueAndValidity();
  }

  addExtension(event: MatChipInputEvent) {
    const input = event.input;
    const value = event.value;

    if ((value || '').trim()) {
      const include = this.editForm.get('fileExtensions.include');
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
    const requiredText = this.editForm.get('requires.text');
    const currentTexts = (requiredText?.value as string[]) || [];
    requiredText?.setValue(currentTexts.filter((t) => t !== text));
    requiredText?.updateValueAndValidity();
  }

  addRequiredText(event: MatChipInputEvent) {
    const input = event.input;
    const value = event.value;

    if ((value || '').trim()) {
      const requiredText = this.editForm.get('requires.text');
      const currentTexts = (requiredText?.value as string[]) || [];
      requiredText?.setValue([...currentTexts, value.trim()]);
      requiredText?.updateValueAndValidity();
    }

    if (input) {
      input.value = '';
    }
  }

  removeTag(tag: string) {
    const tags = this.editForm.get('tags');
    const currentTags = (tags?.value as string[]) || [];
    tags?.setValue(currentTags.filter((t) => t !== tag));
    tags?.updateValueAndValidity();
  }

  addTag(event: MatChipInputEvent) {
    const input = event.input;
    const value = event.value;

    if ((value || '').trim()) {
      const tags = this.editForm.get('tags');
      const currentTags = (tags?.value as string[]) || [];
      tags?.setValue([...currentTags, value.trim()]);
      tags?.updateValueAndValidity();
    }

    if (input) {
      input.value = '';
    }
  }

  removeProjectPath(path: string) {
    const projectPaths = this.editForm.get('projectPaths');
    const currentPaths = (projectPaths?.value as string[]) || [];
    projectPaths?.setValue(currentPaths.filter((p) => p !== path));
    projectPaths?.updateValueAndValidity();
  }

  addProjectPath(event: MatChipInputEvent) {
    const input = event.input;
    const value = event.value;

    if ((value || '').trim()) {
      const projectPaths = this.editForm.get('projectPaths');
      const currentPaths = (projectPaths?.value as string[]) || [];
      projectPaths?.setValue([...currentPaths, value.trim()]);
      projectPaths?.updateValueAndValidity();
    }

    if (input) {
      input.value = '';
    }
  }
}
