import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { AgentService } from 'app/modules/agents/services/agent.service';
import { AgentListComponent } from 'app/modules/agents/agent-list/agent-list.component';
import { NewAutonomousAgentComponent } from './new-agent/new-autonomous-agent/new-autonomous-agent.component';
import { AgentComponent } from "./agent/agent.component";
import {NewAgentComponent} from "./new-agent/new-agent.component";

export default [
    {
        path: '',
        pathMatch: 'full',
        redirectTo: 'list',
    },
    {
        path: 'new',
        component: NewAgentComponent,
    },
    {
        path: 'list',
        component: AgentListComponent,
        resolve: {
            agents: () => inject(AgentService).getAgents(),
        },
    },
    {
        path: ':id',
        component: AgentComponent,
    },
] as Routes;
