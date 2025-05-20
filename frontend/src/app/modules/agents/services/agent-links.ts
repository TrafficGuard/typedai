import {AgentContextApi} from "#shared/schemas/agent.schema";
import {environment} from "../../../../environments/environment";
import type {LlmCall} from "#shared/model/llmCall.model";

/**
 * Interface for generating URLs to the observability services for an agent
 */
export interface AgentLinks {
    traceUrl(agent: AgentContextApi): string;

    logsUrl(agent: AgentContextApi): string;

    agentDatabaseUrl(agent: AgentContextApi): string;

    chatDatabaseUrl(chatId: string): string;

    llmCallUrl(call: LlmCall): string;
}

export class GoogleCloudLinks implements AgentLinks {
    traceUrl(agent: AgentContextApi): string {
        return `https://console.cloud.google.com/traces/list?referrer=search&project=${environment.gcpProject}&supportedpurview=project&pageState=(%22traceIntervalPicker%22:(%22groupValue%22:%22P1D%22,%22customValue%22:null))&tid=${agent.traceId}`;
    }

    logsUrl(agent: AgentContextApi): string {
        // Logging query: resource.type="gce_instance" AND (jsonPayload.agentId="<agentId>" OR jsonPayload.parentAgentId="<agentId>")
        // TODO change resource_type if deployed on Cloud Run
        return `https://console.cloud.google.com/logs/query;query=resource.type%3D%22gce_instance%22%20AND%20%2528jsonPayload.agentId%3D%22${agent.agentId}%22%20OR%20jsonPayload.parentAgentId%3D%22${agent.agentId}%22%2529;duration=PT30M?inv=1&project=${environment.gcpProject}&supportedpurview=project`
    }

    agentDatabaseUrl(agent: AgentContextApi): string {
        return `https://console.cloud.google.com/firestore/databases/${
            environment.firestoreDb || '(default)'
        }/data/panel/AgentContext/${agent?.agentId}?project=${environment.gcpProject}`;
    }

    chatDatabaseUrl(chatId: string): string {
        return `https://console.cloud.google.com/firestore/databases/${
            environment.firestoreDb || '(default)'
        }/data/panel/Chat/${chatId}?project=${environment.gcpProject}`;
    }

    llmCallUrl(call: LlmCall): string {
        return `https://console.cloud.google.com/firestore/databases/${
            environment.firestoreDb || '(default)'
        }/data/panel/LlmCall/${call.id}?project=${environment.gcpProject}`;
    }
}
