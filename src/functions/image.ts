import axios, { AxiosResponse } from 'axios';
import ImageGenerateParams, { OpenAI, OpenAI as OpenAISDK } from 'openai';
import { agentContext, getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { currentUser } from '#user/userContext';
import { envVar } from '#utils/env-var';

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FileStore } from '#functions/storage/filestore';

type ImageSize = '1792x1024' | '256x256' | '512x512' | '1024x1024' | '1024x1792';

@funcClass(__filename)
export class ImageGen {
	openAISDK: OpenAISDK | null = null;

	private sdk(): OpenAISDK {
		if (!this.openAISDK) {
			this.openAISDK = new OpenAISDK({
				apiKey: currentUser().llmConfig.openaiKey ?? envVar('OPENAI_API_KEY'),
			});
		}
		return this.openAISDK;
	}

	/**
	 * Generates an image with the given description
	 * @param description A detailed description of the image
	 * @param {"1792x1024" | "256x256" | "512x512" | "1024x1024" | "1024x1792"} size  the generated image size. Defaults to 256x256
	 * @returns the location of the image file
	 */
	@func()
	async generateImage(description: string, size: ImageSize = '256x256'): Promise<string> {
		const response = await this.sdk().images.generate({
			model: 'dall-e-3',
			prompt: description,
			n: 1,
			size,
		});
		const imageUrl = response.data?.[0].url;
		if (!imageUrl) throw new Error('Failed to generate image');
		logger.debug(`Generated image at ${imageUrl}`);

		// Fetch the image bytes
		const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
		const contentType = imageResponse.headers['content-type'];

		logger.debug('The image is in the format:', contentType);

		const imageBytes = Buffer.from(imageResponse.data, 'binary');

		let filename = await llms().easy.generateText(
			`<description>${description}</description>\nGenerate a valid filename that is 5 words at most from the description. Answer only with the filename and do not add a file extension.`,
		);
		filename += '.png';

		const fileStore: FileStore = agentContext()?.functions.getFunctionType('filestore');
		let filePath: string;
		if (fileStore) {
			filePath = await fileStore.saveFile(filename, imageBytes, description);
		} else {
			writeFileSync(filename, imageBytes);
			filePath = path.join(process.cwd(), filename);
		}
		logger.debug(`Saved image to ${filePath}`);

		return filePath;
	}
}
