import { Routes } from '@angular/router';
// AgentListComponent is standalone, imported via loadComponent
// NewAgentComponent is standalone, imported via loadComponent
// AgentComponent is standalone, imported via loadComponent

export const AGENT_ROUTE_DEFINITIONS = {
    base: '/ui/agents', // Assuming '/agents' is the base path for this module's routes
    segments: {
        list: 'list',
        new: 'new',
        detail: ':id', // Represents the path segment for a dynamic agent ID
    },
    nav: {
        list: () => [AGENT_ROUTE_DEFINITIONS.base, AGENT_ROUTE_DEFINITIONS.segments.list],
        new: () => [AGENT_ROUTE_DEFINITIONS.base, AGENT_ROUTE_DEFINITIONS.segments.new],
        detail: (agentId: string) => [AGENT_ROUTE_DEFINITIONS.base, agentId],
    }
} as const;

const agentRoutes: Routes = [
    {
        path: '', // This path is relative to where these routes are loaded (e.g., under /agents)
        pathMatch: 'full',
        redirectTo: AGENT_ROUTE_DEFINITIONS.segments.list,
    },
    {
        path: AGENT_ROUTE_DEFINITIONS.segments.new,
        // Assuming NewAgentComponent is or will be standalone
        loadComponent: () => import('./new-agent/new-agent.component').then(m => m.NewAgentComponent),
    },
    {
        path: AGENT_ROUTE_DEFINITIONS.segments.list,
        loadComponent: () => import('app/modules/agents/agent-list/agent-list.component').then(m => m.AgentListComponent),
        // Resolver removed as AgentService loads data in constructor and component subscribes to state.
    },
    {
        path: AGENT_ROUTE_DEFINITIONS.segments.detail, // This will be ':id'
        loadComponent: () => import('./agent/agent.component').then(m => m.AgentComponent),
        // If AgentComponent's template used <router-outlet> for tabs, child routes would go here.
        // Since it directly embeds components, no child routes are needed here for the tabs.
    },
];

export default agentRoutes;
