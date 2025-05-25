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
        // Resolver removed as AgentService loads data in constructor and component subscribes to state.
    },
    {
        path: ':id',
        loadComponent: () => import('./agent/agent.component').then(m => m.AgentComponent),
        // If AgentComponent's template used <router-outlet> for tabs, child routes would go here.
        // Since it directly embeds components, no child routes are needed here for the tabs.
    },
] as Routes;
