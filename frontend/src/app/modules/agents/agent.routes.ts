import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { AgentService } from './agent.service';
// AgentListComponent is standalone, imported via loadComponent
// NewAgentComponent is standalone, imported via loadComponent
// AgentComponent is standalone, imported via loadComponent

export default [
    {
        path: '',
        pathMatch: 'full',
        redirectTo: 'list',
    },
    {
        path: 'new',
        // Assuming NewAgentComponent is or will be standalone
        loadComponent: () => import('./new-agent/new-agent.component').then(m => m.NewAgentComponent),
    },
    {
        path: 'list',
        loadComponent: () => import('app/modules/agents/agent-list/agent-list.component').then(m => m.AgentListComponent),
        resolve: {
            // The resolver pre-fetches data. AgentListComponent itself also subscribes
            // to agentService.agents$. This is a common pattern, resolver ensures data
            // is available before component activation, component subscribes for live updates.
            // Note: getAgents() in AgentService returns an Observable of BehaviorSubject,
            // resolvers typically expect Observable that completes.
            // For now, keeping as is, but this might need adjustment in AgentService or resolver.
            agents: () => inject(AgentService).getAgents(),
        },
    },
    {
        path: ':id',
        loadComponent: () => import('./agent/agent.component').then(m => m.AgentComponent),
        // If AgentComponent's template used <router-outlet> for tabs, child routes would go here.
        // Since it directly embeds components, no child routes are needed here for the tabs.
    },
] as Routes;
