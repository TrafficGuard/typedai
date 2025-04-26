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
// Removed VibeListComponent import

@Component({
  selector: 'app-vibe', // Changed selector to be more specific
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

    // Removed the call to this.vibeService.listVibes() and related logic
    // TODO: Add logic here if this component needs to fetch data for the form (e.g., repo list for dropdown)
  }
}
