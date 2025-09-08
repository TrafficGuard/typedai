export function formatMillisDuration(duration: number): string {
	const millisecondsInASecond = 1000;
	const millisecondsInAMinute = 60 * millisecondsInASecond;
	const millisecondsInAnHour = 60 * millisecondsInAMinute;
	const millisecondsInADay = 24 * millisecondsInAnHour;

	const days = Math.floor(duration / millisecondsInADay);
	duration %= millisecondsInADay;
	const hours = Math.floor(duration / millisecondsInAnHour);
	duration %= millisecondsInAnHour;
	const minutes = Math.floor(duration / millisecondsInAMinute);
	duration %= millisecondsInAMinute;
	const seconds = Math.floor(duration / millisecondsInASecond);
	const milliseconds = duration % millisecondsInASecond;

	const parts: string[] = [];

	if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
	if (hours > 0) parts.push(`${hours}hr`);
	if (minutes > 0) parts.push(`${minutes}min`);
	if (seconds > 0) parts.push(`${seconds}s`);
	if (milliseconds > 0 || parts.length === 0) {
		parts.push(`${milliseconds}ms`);
	}

	return parts.join(', ').replace(/,([^,]*)$/, (match, p1) => ` ${p1}`);
}
