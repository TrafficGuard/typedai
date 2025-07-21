import axios from 'axios';
import { logger } from '#o11y/logger';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

// https://cloud.google.com/datastore/docs/emulator#reset_emulator_data
const instance = axios.create({
	baseURL: `http://${emulatorHost}/`,
});

export async function resetFirestoreEmulator(): Promise<void> {
	if (!emulatorHost) console.error('FIRESTORE_EMULATOR_HOST not defined');
	try {
		const response = await instance.post('reset');
		// Axios throws an error for responses outside the 2xx range, so the following check is optional
		// and generally not needed unless you configure axios to not throw on certain status codes.
		if (response.status !== 200) {
			logger.error('Failed to reset emulator data:', response.status, response.statusText);
		}
	} catch (error) {
		// Axios encapsulates the response error as error.response
		logger.error(error.response ?? error, 'Error resetting emulator data:');
	}
}
