import {AgentContext} from "../model/agent.model";
import {ChangePropertyType} from "#shared/typeUtils";

export type AgentContextApi = ChangePropertyType<AgentContext, 'functions', string[]>