import { defineRoute } from '#shared/api-definitions';
import { AdminDashboardStatsSchema } from '../model/admin.model';

export const adminApi = {
	getDashboardStats: defineRoute('GET', '/api/v1/admin/dashboard/stats', {
		schema: {
			response: {
				200: AdminDashboardStatsSchema,
			},
		},
	}),
	// Add other admin-related API endpoints here as needed
};
