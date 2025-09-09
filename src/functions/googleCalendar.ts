import { differenceInMilliseconds } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { calendar_v3, google } from 'googleapis';
import { func, funcClass } from '#functionSchema/functionDecorators';

interface CalendarEvent {
	summary: string;
	startTime: string;
	endTime: string;
	durationInHours: number;
}

@funcClass(__filename)
export class GoogleCalendar {
	private async calendar(): Promise<calendar_v3.Calendar> {
		// const auth = new google.auth.OAuth2({
		// 	clientId: 'YOUR_CLIENT_ID',
		// 	clientSecret: 'YOUR_CLIENT_SECRET',
		// 	redirectUri: 'YOUR_REDIRECT_URI',
		// });
		// // Use the OAuth2 flow to get a valid token and set it here:
		// auth.setCredentials({ refresh_token: 'YOUR_REFRESH_TOKEN' });
		// const calendar = google.calendar({ version: 'v3', auth });
		// return calendar;
		const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/calendar.readonly'] });
		const calendar = google.calendar({ version: 'v3', auth });
		return calendar;
	}

	/**
	 *
	 * @param from The start of the time range to get events for
	 * @param to The end of the time range to get events for
	 * @param targetTimezone (Optional) defaults to Australia/Perth
	 * @param calendarId (Optional) defaults to primary
	 */
	@func()
	async listEvents(from: string, to: string, targetTimezone = 'Australia/Perth', calendarId = 'primary'): Promise<CalendarEvent[]> {
		const calendar = await this.calendar();
		const res = await calendar.events.list({
			calendarId,
			timeMin: from,
			timeMax: to,
			maxResults: 20,
			singleEvents: true,
			orderBy: 'startTime',
		});
		return processCalendarEvents(res.data.items ?? [], targetTimezone);
	}
}

function processCalendarEvents(events: calendar_v3.Schema$Event[], targetTimezone: string): CalendarEvent[] {
	const processedEvents: CalendarEvent[] = [];

	for (const event of events) {
		// Case 1: Ignore All-Day Events (like your "Office" event)
		if (event.start?.date) {
			continue; // Move to the next event
		}

		// Case 2: Handle Timed Events (all other events)
		if (event.start?.dateTime && event.end?.dateTime) {
			// The native JavaScript Date object can parse ISO 8601 strings correctly.
			// It will represent the correct moment in time.
			const startDate = new Date(event.start.dateTime);
			const endDate = new Date(event.end.dateTime);

			// Calculate duration
			const durationInMs = differenceInMilliseconds(endDate, startDate);
			const durationInHours = durationInMs / (1000 * 60 * 60);

			// Format the start and end times into your target timezone for display.
			// The format 'yyyy-MM-dd HH:mm:ss zzz' is very explicit and shows the timezone.
			const formatString = 'h:mm a'; // e.g., '2:00 PM'

			const startTime = formatInTimeZone(startDate, targetTimezone, formatString);
			const endTime = formatInTimeZone(endDate, targetTimezone, formatString);

			processedEvents.push({
				summary: event.summary ?? '',
				startTime,
				endTime,
				durationInHours: Number(durationInHours.toFixed(2)),
			});
		}
	}

	return processedEvents;
}
