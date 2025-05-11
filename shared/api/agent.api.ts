import {AgentContext} from "../model/agent.model";
import {NewType} from "#shared/typeUtils";


export type AgentContextApi = NewType<AgentContext, 'functions', string[]>