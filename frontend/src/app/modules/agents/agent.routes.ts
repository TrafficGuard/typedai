import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { AgentService } from 'app/modules/agents/services/agent.service';
import { AgentListComponent } from 'app/modules/agents/agent-list/agent-list.component';
// NewAutonomousAgentComponent is not directly used in routes, but NewAgentComponent is.
// import { NewAutonomousAgentComponent } from './new-agent/new-autonomous-agent/new-autonomous-agent.component';
import { AgentComponent } from "./agent/agent.component";
import { NewAgentComponent } from "./new-agent/new-agent.component";

export default [
    {
        path: '',
        pathMatch: 'full',
        redirectTo: 'list',
    },
    {
        path: 'new',
        component: NewAgentComponent, // This component likely uses NewAutonomousAgentComponent internally
    },
    {
        path: 'list',
        component: AgentListComponent, // AgentListComponent is now standalone
        resolve: {
            // The resolver pre-fetches data. AgentListComponent itself also subscribes
            // to agentService.agents$. This is a common pattern, resolver ensures data
            // is available before component activation, component subscribes for live updates.
            agents: () => inject(AgentService).getAgents(),
        },
    },
    {
        path: ':id',
        component: AgentComponent, // Assuming AgentComponent is also standalone or part of a module
    },
] as Routes;
