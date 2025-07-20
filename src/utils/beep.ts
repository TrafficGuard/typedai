import { sleep } from '#utils/async-utils';

export async function beep(): Promise<void> {
	const delayMs = 100;
	const beeps = 3;

	for (let i = 0; i < beeps; i++) {
		process.stdout.write('\u0007');
		await sleep(delayMs);
	}
}
