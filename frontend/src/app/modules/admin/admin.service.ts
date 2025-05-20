import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { callApiRoute } from '../../core/api-route';
import { AdminDashboardStats } from '../../../../shared/model/admin.model';
import { adminApi } from '../../../../shared/api/admin.api';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);

  fetchDashboardStats(): Observable<AdminDashboardStats> {
    return callApiRoute(this.http, adminApi.getDashboardStats);
  }
}
