import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common'; // Import CommonModule for *ngIf, etc.
import { AdminService } from '../admin.service';
import { AdminDashboardStats } from '../../../../../shared/model/admin.model'; // Adjusted path

@Component({
  selector: 'app-admin-home', // Updated selector
  standalone: true,
  imports: [CommonModule], // Add CommonModule and other necessary modules like JsonPipe if needed
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'], // Assuming SCSS file exists or will be created
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ViewEncapsulation.None can be kept if needed, or removed if default is fine.
  // For this refactor, let's remove it to use Angular's default (Emulated) unless specified otherwise.
})
export class HomeComponent implements OnInit {
  private adminService = inject(AdminService);

  stats = signal<AdminDashboardStats | undefined>(undefined);
  isLoading = signal<boolean>(false);
  errorMessage = signal<string | undefined>(undefined);

  /**
   * Constructor
   */
  constructor() {
    // Constructor logic can be added here if needed
  }

  ngOnInit(): void {
    this.loadDashboardStats();
  }

  loadDashboardStats(): void {
    this.isLoading.set(true);
    this.errorMessage.set(undefined);
    this.adminService.fetchDashboardStats().subscribe({
      next: (data) => {
        this.stats.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to fetch admin dashboard stats:', err);
        this.errorMessage.set('Could not load dashboard statistics. Please try again later.');
        this.isLoading.set(false);
      },
    });
  }
}
