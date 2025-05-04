import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import fetch from 'cross-fetch';
import { agentStorageDir } from '#app/appVars';
import type { FileStore } from '#functions/storage/filestore';
import type { ImagePartExt } from '#llm/llm';
import { logger } from '#o11y/logger';
import { getMimeType } from '#utils/mime';

// Define the expected structure for image requests in the script result
export interface ImageSource {
	type: 'image';
	source: 'filesystem' | 'filestore' | 'bytes' | 'buffer' | 'web' | 'gcs';
	/**
	 * Specifies the image source details based on the 'source' field:
	 * - filesystem: The file path (string).
	 * - filestore: The filename identifier (string).
	 * - bytes/buffer: The image data (Buffer | Uint8Array | object).
	 * - web/gcs: The URL (string).
	 */
	specifier: string | Buffer | Uint8Array | object; // Type needs to be broad
	filename?: string; // for filestore or buffer (optional)
	mimeType?: string; // optional hint
}

/**
 * Parses the Python script result dictionary to find image requests and load image data that will be passed to the next agent planning LLM call
 * @param result The dictionary returned by the Python script.
 * @param fileStore Optional FileStore instance if the 'filestore' source is used.
 * @returns An array of ImagePartExt objects ready to be included in the LLM prompt.
 */
export async function checkForImageSources(result: Record<string, any>, fileStore?: FileStore): Promise<ImagePartExt[]> {
	logger.info('checkForImageSources');
	const imageParts: ImagePartExt[] = [];

	if (!result || typeof result !== 'object') return imageParts;

	for (const key in result) {
		// Ensure it's an own property before processing
		if (!Object.hasOwn(result, key)) continue;
		const value = result[key];

		// Check if the value matches the image request structure
		if (typeof value === 'object' && value !== null && value.type === 'image' && typeof value.source === 'string') {
			const request = value as ImageSource;
			let imageData: Buffer | undefined;
			let filename: string | undefined;
			let mimeType: string | undefined;
			let size: number | undefined;

			logger.info(`Detected image request in script result key '${key}': source=${request.source}`);

			try {
				switch (request.source) {
					case 'bytes': {
						let bufferData = request.specifier;
						const sourceDescription = `key '${key}' (source: bytes)`;
						logger.debug(`Processing ${sourceDescription}. Specifier type: ${typeof bufferData}`); // Log type

						// Optionally log a small part of the specifier if it's an object
						if (typeof bufferData === 'object' && bufferData !== null) {
							try {
								const keys = Object.keys(bufferData);
								logger.debug(`Specifier keys (first 10): ${keys.slice(0, 10).join(', ')}`);
								if (keys.length > 0) {
									const firstKey = keys[0];
									logger.debug(`Type of first value (key: ${firstKey}): ${typeof bufferData[firstKey]}`);
								}
							} catch (logErr) {
								logger.warn('Error logging specifier details:', logErr);
							}
						}

						// 1. Check for Pyodide proxy first (if it might still occur)
						if (bufferData && typeof (bufferData as any).tobytes === 'function') {
							logger.debug(`Detected Pyodide buffer proxy for ${sourceDescription}, converting.`);
							bufferData = (bufferData as any).tobytes(); // Convert Pyodide proxy to Uint8Array
						}

						// 2. Check if it's already a Buffer or Uint8Array after potential proxy conversion
						if (bufferData && (Buffer.isBuffer(bufferData) || bufferData instanceof Uint8Array)) {
							imageData = Buffer.isBuffer(bufferData) ? bufferData : Buffer.from(bufferData);
							logger.debug(`Using direct Buffer/Uint8Array for ${sourceDescription}.`);
						}
						// 3. Check if it's the index-object format from JSON serialization
						else if (typeof bufferData === 'object' && bufferData !== null && !Array.isArray(bufferData)) {
							const keys = Object.keys(bufferData);
							const allKeysAreNumeric = keys.every((k) => /^\d+$/.test(k)); // Check keys first

							if (allKeysAreNumeric) {
								logger.debug(`Detected potential index-object format for ${sourceDescription}, attempting conversion.`);
								try {
									const entries = Object.entries(bufferData as Record<string, any>); // Use any for value initially
									logger.debug(`Index-object has ${entries.length} entries.`);

									const filteredEntries = entries.filter(([, v]) => typeof v === 'number');
									logger.debug(`Index-object has ${filteredEntries.length} entries with numeric values.`);

									if (filteredEntries.length === 0 && entries.length > 0) {
										logger.warn(`Index-object values are not numbers. First value type: ${typeof entries[0][1]}`);
									}

									// Sort by numeric key to ensure correct byte order
									const sortedEntries = filteredEntries.sort(([keyA], [keyB]) => Number.parseInt(keyA, 10) - Number.parseInt(keyB, 10));

									// Extract the byte value (the second element of the [key, value] tuple)
									const byteValues = sortedEntries.map(([, byteValue]) => byteValue as number); // Cast to number here

									if (byteValues.length > 0) {
										imageData = Buffer.from(byteValues);
										logger.debug(`Successfully converted index-object to Buffer for ${sourceDescription} (${byteValues.length} bytes).`);
									} else {
										// This case now implies the object was empty or all values were non-numeric
										logger.warn(`Index-object for ${sourceDescription} resulted in zero valid byte values after filtering/processing.`);
									}
								} catch (conversionError) {
									logger.error(conversionError, `Failed during index-object conversion for ${sourceDescription}.`);
									// imageData remains undefined
								}
							} else {
								logger.warn(`Detected object for ${sourceDescription}, but keys are not all numeric. Keys (first 10): ${keys.slice(0, 10).join(', ')}`);
							}
						} else {
							// Log if bufferData is not an object, buffer, uint8array, or proxy
							logger.warn(
								`Specifier for ${sourceDescription} is not a recognized format (Object, Buffer, Uint8Array, PyodideProxy). Type: ${typeof bufferData}`,
							);
						}

						// 4. If imageData was successfully created (from any method above), process filename/mimeType
						if (imageData) {
							filename = typeof request.filename === 'string' ? request.filename : `screenshot_${Date.now()}.png`;
							mimeType = typeof request.mimeType === 'string' ? request.mimeType : getMimeType(filename) || 'image/png'; // Default to png
							size = imageData.length;

							imageParts.push({
								type: 'image',
								image: imageData, // The actual Buffer
								mimeType: mimeType,
								filename: filename,
								size: size,
							});
							logger.info(`Successfully processed image for key '${key}' (filename: ${filename}, size: ${size}, mime: ${mimeType})`);
							// Remove the processed image request object from the result
							delete result[key];
						} else {
							// Log if data was present but couldn't be processed into imageData
							logger.warn(`Failed to create imageData for ${sourceDescription}. Check previous logs for reason.`); // Simplified warning
							// ---> Ensure the unprocessed entry is removed even on failure <---
							delete result[key];
						}
						break;
					}
					case 'filesystem':
						if (request.specifier && typeof request.specifier === 'string') {
							const fullPath = path.resolve(agentStorageDir(), request.specifier);
							// Security check: Ensure path is within the allowed agent directory
							if (!fullPath.startsWith(agentStorageDir())) throw new Error(`Filesystem path "${request.specifier}" is outside the allowed agent directory.`);
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

					// case 'buffer': {
					// 	// Handle potential Pyodide buffer proxy
					// 	let bufferData = request.specifier;
					// 	if (bufferData && typeof bufferData.tobytes === 'function') {
					// 		logger.debug(`Detected Pyodide buffer proxy for key '${key}', converting.`);
					// 		bufferData = bufferData.tobytes(); // Convert Pyodide proxy to Uint8Array
					// 	}
					//
					// 	if (bufferData && (Buffer.isBuffer(bufferData) || bufferData instanceof Uint8Array)) {
					// 		imageData = Buffer.isBuffer(bufferData) ? bufferData : Buffer.from(bufferData);
					// 		// Use provided filename or generate one
					// 		filename = typeof request.filename === 'string' ? request.filename : `buffer_image_${Date.now()}.bin`;
					// 		// Try to infer mime type if provided, otherwise use filename, then default
					// 		mimeType = typeof request.mimeType === 'string' ? request.mimeType : getMimeType(filename);
					// 		size = imageData.length;
					// 	} else {
					// 		logger.warn(`Buffer image request for key '${key}' is missing 'data' or data is not a Buffer/Uint8Array.`);
					// 	}
					// 	break;
					// }

					case 'web':
						if (request.specifier && typeof request.specifier === 'string') {
							const response = await fetch(request.specifier);
							if (!response.ok) throw new Error(`Failed to fetch web image from ${request.specifier}: ${response.statusText}`);

							const arrayBuffer = await response.arrayBuffer();
							imageData = Buffer.from(arrayBuffer);
							try {
								filename = path.basename(new URL(request.specifier).pathname) || `web_image_${Date.now()}`;
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
