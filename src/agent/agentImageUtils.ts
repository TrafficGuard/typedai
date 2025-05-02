import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import fetch from 'cross-fetch';
import { agentStorageDir } from '#app/appVars';
import type { FileStore } from '#functions/storage/filestore';
import type { ImagePartExt } from '#llm/llm';
import { logger } from '#o11y/logger';
import { getMimeType } from '#utils/mime';

// Define the expected structure for image requests in the script result
interface ImageRequest {
	type: 'image';
	source: 'filesystem' | 'filestore' | 'buffer' | 'web' | 'gcs';
	path?: string; // for filesystem
	filename?: string; // for filestore or buffer (optional)
	data?: Buffer | Uint8Array | any; // for buffer (allow 'any' due to pyodide proxy potential)
	url?: string; // for web, gcs
	mimeType?: string; // optional hint for buffer
}

/**
 * Parses the Python script result dictionary to find image requests and load image data that will be passed to the next agent planning LLM call
 * @param result The dictionary returned by the Python script.
 * @param fileStore Optional FileStore instance if the 'filestore' source is used.
 * @returns An array of ImagePartExt objects ready to be included in the LLM prompt.
 */
export async function checkForImageSources(result: Record<string, any>, fileStore?: FileStore): Promise<ImagePartExt[]> {
	const imageParts: ImagePartExt[] = [];

	if (!result || typeof result !== 'object') return imageParts;

	for (const key in result) {
		// Ensure it's an own property before processing
		if (!Object.hasOwn(result, key)) continue;
		const value = result[key];

		// Check if the value matches the image request structure
		if (typeof value === 'object' && value !== null && value.type === 'image' && typeof value.source === 'string') {
			const request = value as ImageRequest;
			let imageData: Buffer | undefined;
			let filename: string | undefined;
			let mimeType: string | undefined;
			let size: number | undefined;

			logger.info(`Detected image request in script result key '${key}': source=${request.source}`);

			try {
				switch (request.source) {
					case 'filesystem':
						if (request.path && typeof request.path === 'string') {
							const fullPath = path.resolve(agentStorageDir(), request.path);
							// Security check: Ensure path is within the allowed agent directory
							if (!fullPath.startsWith(agentStorageDir())) throw new Error(`Filesystem path "${request.path}" is outside the allowed agent directory.`);
							imageData = await fsPromises.readFile(fullPath);
							filename = path.basename(fullPath);
							mimeType = getMimeType(filename);
							size = imageData.length;
						} else {
							logger.warn(`Filesystem image request for key '${key}' is missing or has invalid 'path'.`);
						}
						break;

					case 'filestore':
						if (fileStore && request.filename && typeof request.filename === 'string') {
							const fileContent = await fileStore.getFile(request.filename);
							imageData = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent);
							filename = request.filename;
							mimeType = getMimeType(filename);
							size = imageData.length;
						} else {
							logger.warn(`FileStore image request for key '${key}' is missing 'filename' or FileStore instance is not available.`);
						}
						break;

					case 'buffer': {
						// Handle potential Pyodide buffer proxy
						let bufferData = request.data;
						if (bufferData && typeof bufferData.tobytes === 'function') {
							logger.debug(`Detected Pyodide buffer proxy for key '${key}', converting.`);
							bufferData = bufferData.tobytes(); // Convert Pyodide proxy to Uint8Array
						}

						if (bufferData && (Buffer.isBuffer(bufferData) || bufferData instanceof Uint8Array)) {
							imageData = Buffer.isBuffer(bufferData) ? bufferData : Buffer.from(bufferData);
							// Use provided filename or generate one
							filename = typeof request.filename === 'string' ? request.filename : `buffer_image_${Date.now()}.bin`;
							// Try to infer mime type if provided, otherwise use filename, then default
							mimeType = typeof request.mimeType === 'string' ? request.mimeType : getMimeType(filename);
							size = imageData.length;
						} else {
							logger.warn(`Buffer image request for key '${key}' is missing 'data' or data is not a Buffer/Uint8Array.`);
						}
						break;
					}

					case 'web':
						if (request.url && typeof request.url === 'string') {
							const response = await fetch(request.url);
							if (!response.ok) throw new Error(`Failed to fetch web image from ${request.url}: ${response.statusText}`);

							const arrayBuffer = await response.arrayBuffer();
							imageData = Buffer.from(arrayBuffer);
							try {
								filename = path.basename(new URL(request.url).pathname) || `web_image_${Date.now()}`;
							} catch {
								filename = `web_image_${Date.now()}`; // Fallback filename if URL parsing fails
							}
							mimeType = response.headers.get('content-type') || getMimeType(filename);
							size = imageData.byteLength;
						} else {
							logger.warn(`Web image request for key '${key}' is missing or has invalid 'url'.`);
						}
						break;

					case 'gcs':
						// TODO: Implement GCS fetching logic if needed
						logger.warn(`GCS image source for key '${key}' is not yet implemented.`);
						break;

					default:
						logger.warn(`Unknown image source '${(request as any).source}' for key '${key}'.`);
				}

				if (imageData && filename && mimeType && size !== undefined) {
					imageParts.push({
						type: 'image',
						image: imageData,
						mimeType: mimeType,
						filename: filename,
						size: size,
					});
					logger.info(`Successfully processed image for key '${key}' (filename: ${filename}, size: ${size}, mime: ${mimeType})`);
					// Remove the processed image request object from the result
					delete result[key];
				}
			} catch (error) {
				logger.error(error, `Failed to load image for key '${key}' (source: ${request.source}): ${error instanceof Error ? error.message : String(error)}`);
				delete result[key];
			}
		}
	}

	return imageParts;
}
