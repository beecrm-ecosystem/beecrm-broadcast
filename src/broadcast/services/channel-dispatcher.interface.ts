import { SendMessageJob } from '../queues/broadcast.processor';

export interface DispatchResult {
  success: boolean;
  externalId?: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface ChannelDispatcher {
  channel: string;
  sendMessage(job: SendMessageJob): Promise<DispatchResult>;
  buildComponents?(templateData: any, variables: Record<string, string>): any;
}
