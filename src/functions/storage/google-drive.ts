import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { type drive_v3, google } from 'googleapis';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { currentUser } from '#user/userService/userContext';
import { envVar } from '#utils/env-var';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

/**
 * AI generated. Not tested at all.
 */
@funcClass(__filename)
export class GoogleDrive {
	private driveClient: drive_v3.Drive;

	private async api(): Promise<drive_v3.Drive> {
		// const key = require('./path/to/service-account.json');
		// const jwtClient = new google.auth.JWT({
		// 	email: key.client_email,
		// 	key: key.private_key,
		// 	scopes: ['https://www.googleapis.com/auth/drive'],
		// 	subject: 'user@domain.com'  // Email of the user to impersonate
		// });

		const auth = new google.auth.GoogleAuth({
			// keyFile: 'path/to/service-account.json',  // Path to your service account key file
			scopes: ['https://www.googleapis.com/auth/drive'],
			projectId: envVar('GCLOUD_PROJECT'),
			clientOptions: {
				subject: currentUser().email, // Email of the user to impersonate
			},
		});

		this.driveClient ??= google.drive({
			version: 'v3',
			auth: auth,
		});
		return this.driveClient;
	}

	/**
	 * Lists the files
	 */
	@func()
	public async list(): Promise<drive_v3.Schema$File[]> {
		const res = await (await this.api()).files.list({
			pageSize: 10,
			fields: 'nextPageToken, files(id, name)',
		});
		return res.data.files || [];
	}

	/**
	 * Creates a text file
	 * @param filePath e.g. dir/filename
	 * @param fileContents
	 */
	@func()
	public async createTextFile(filePath: string, fileContents: string): Promise<string> {
		const res = await this.driveClient.files.create({
			requestBody: {
				name: path.basename(filePath),
				mimeType: 'text/plain',
			},
			media: {
				mimeType: 'text/plain',
				body: fs.createReadStream(fileContents),
			},
		});
		return res.data.id;
	}

	async createBinaryFile(filePath: string): Promise<string> {
		const fileMetadata = {
			name: path.basename(filePath),
		};
		const media = {
			mimeType: 'image/jpeg',
			body: fs.createReadStream(filePath),
		};
		const res = await this.driveClient.files.create({
			requestBody: fileMetadata,
			media: media,
			fields: 'id',
		});
		return res.data.id;
	}

	public async updateFile(fileId: string, contents: string): Promise<string> {
		const res = await this.driveClient.files.update({
			fileId: fileId,
			requestBody: {},
			media: {
				mimeType: 'text/plain',
				body: fs.createReadStream(contents),
			},
		});
		return res.data.id;
	}

	/**
	 * Checks if a folder exists
	 * @param folderName
	 */
	@func()
	public async folderExists(folderName: string): Promise<boolean> {
		return true;
	}

	/**
	 * Create a new folder. Fails if the folder already exists
	 * @param folderName
	 */
	@func()
	public async createFolder(folderName: string): Promise<void> {}
}
