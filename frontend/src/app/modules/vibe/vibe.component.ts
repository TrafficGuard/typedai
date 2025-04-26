import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { CommonModule } from "@angular/common";
import {RouterModule, RouterOutlet} from "@angular/router";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatCardModule } from "@angular/material/card";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatInputModule } from '@angular/material/input';
import {MatIconModule} from "@angular/material/icon";
import {MatButtonModule} from "@angular/material/button";
import {VibeService} from "./vibe.service";
import {VibeListComponent} from "./vibe-list/vibe-list.component";

@Component({
  selector: 'app-code',
  templateUrl: './vibe.component.html',
  styleUrls: ['./vibe.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatCardModule,
    MatProgressBarModule,
    MatInputModule,
    MatButtonModule,
    RouterOutlet,
    VibeListComponent,
  ]
})
export class VibeComponent implements OnInit {
  codeForm!: FormGroup;
  result: string = '';
  isLoading = false;
  vibes: string[] = [];

  constructor(private fb: FormBuilder, private vibeService: VibeService) {}

  ngOnInit() {
    this.codeForm = this.fb.group({
      workingDirectory: ['', Validators.required],
      workflowType: ['code', Validators.required],
      input: ['', Validators.required],
    });

    this.vibeService.listVibes().subscribe({
      next: (repos: string[]) => {
        this.vibes = repos;
        if (repos.length > 0) {
          this.codeForm.patchValue({ workingDirectory: repos[0] });
        }
      },
      error: (error: any) => {
        console.error('Error fetching vibes:', error);
        this.result = 'Error fetching vibes. Please try again later.';
      },
    });
  }
}
