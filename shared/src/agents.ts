export type AgentName =
  | 'Discovery'
  | 'Financials'
  | 'Footprint'
  | 'Campaign'
  | 'Competitor'
  | 'Geo'
  | 'Strategy';

export type AgentStatus = 'pending' | 'running' | 'done' | 'failed';

export interface AgentProgressEvent {
  agent: AgentName;
  status: AgentStatus;
  detail?: string;
  data?: unknown;
}

export interface ResearchCompleteEvent {
  type: 'complete';
  brief: import('./campaign-brief.js').CampaignBrief;
}

export interface ResearchErrorEvent {
  type: 'error';
  message: string;
}

export type SseEvent =
  | ({ type: 'agent' } & AgentProgressEvent)
  | ResearchCompleteEvent
  | ResearchErrorEvent;
