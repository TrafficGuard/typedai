export interface SlackStatusResponseModel {
	status: 'connected' | 'disconnected';
}

export interface SlackActionResponseModel {
	success: boolean;
}
