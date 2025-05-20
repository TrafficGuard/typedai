import { type Static, Type } from '@sinclair/typebox';

export const AdminDashboardStatsSchema = Type.Object({
	activeUsers: Type.Number(),
	totalProjects: Type.Number(),
	// Add other relevant stats fields as they become defined
});

export type AdminDashboardStats = Static<typeof AdminDashboardStatsSchema>;
