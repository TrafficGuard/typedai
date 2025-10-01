import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { callApiRoute } from 'app/core/api-route';
import { SLACK_API } from '#shared/slack/slack.api';
import type { SlackActionResponseModel, SlackStatusResponseModel } from '#shared/slack/slack.model';

@Injectable({ providedIn: 'root' })
export class SlackService {
	private readonly httpClient = inject(HttpClient);

	getStatus(): Observable<SlackStatusResponseModel> {
		return callApiRoute(this.httpClient, SLACK_API.status);
	}

	startBot(): Observable<SlackActionResponseModel> {
		return callApiRoute(this.httpClient, SLACK_API.start);
	}

	stopBot(): Observable<SlackActionResponseModel> {
		return callApiRoute(this.httpClient, SLACK_API.stop);
	}
}
