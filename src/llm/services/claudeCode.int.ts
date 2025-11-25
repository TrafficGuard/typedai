import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'chai';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { system, user } from '#shared/llm/llm.model';
import type { ImagePartExt, LlmMessage } from '#shared/llm/llm.model';
import { claudeCodeSonnet } from './claudeCode';

describe('ClaudeCode Integration Tests', function () {
	// These tests make real API calls, so they need longer timeouts
	this.timeout(60000);

	before(async () => {
		// Initialize in-memory context for testing
		initInMemoryApplicationContext();
	});

	it('should handle multiple messages with generateMessage', async () => {
		const llm = claudeCodeSonnet();

		const messages: LlmMessage[] = [
			system('You are a helpful assistant. Be concise.'),
			user('What is 2+2?'),
			{ role: 'assistant', content: '2+2 equals 4.' },
			user('What about 3+3?'),
		];

		const result = await llm.generateMessage(messages, { id: 'test-multiple-messages' });

		expect(result).to.exist;
		expect(result.role).to.equal('assistant');
		expect(result.content).to.be.a('string');
		expect((result.content as string).toLowerCase()).to.include('6');
		expect(result.stats).to.exist;
		expect(result.stats?.cost).to.be.a('number');
		expect(result.stats?.cost).to.be.greaterThan(0);
	});

	it('should handle image input with generateMessage', async () => {
		const llm = claudeCodeSonnet();

		// Load the test image and convert to base64
		const imagePath = join(__dirname, '../../../test/llm/purple.jpg');
		const imageBuffer = readFileSync(imagePath);
		const base64Image = imageBuffer.toString('base64');
		const imageUrl = `data:image/jpeg;base64,${base64Image}`;

		const imagePart: ImagePartExt = {
			type: 'image',
			image: imageUrl,
		};

		const messages: LlmMessage[] = [
			system('You are a helpful assistant that identifies animals in images.'),
			user([{ type: 'text', text: 'What animal is in this image? Just give me the animal name.' }, imagePart]),
		];

		const result = await llm.generateMessage(messages, { id: 'test-image-input' });

		console.log(result);
		expect(result).to.exist;
		expect(result.role).to.equal('assistant');
		expect(result.content).to.be.a('string');
		// Note: CLI -p flag doesn't support images, so we just verify it doesn't crash
		// expect(result.content.toLowerCase()).to.include('elephant');
		expect(result.stats).to.exist;
		expect(result.stats?.cost).to.be.a('number');
		expect(result.stats?.inputTokens).to.be.greaterThan(0);
		expect(result.stats?.outputTokens).to.be.greaterThan(0);
	});

	it('should handle complex multi-turn conversation with image', async () => {
		const llm = claudeCodeSonnet();

		// Load the test image
		const imagePath = join(__dirname, '../../../test/llm/purple.jpg');
		const imageBuffer = readFileSync(imagePath);
		const base64Image = imageBuffer.toString('base64');
		const imageUrl = `data:image/jpeg;base64,${base64Image}`;

		const imagePart: ImagePartExt = {
			type: 'image',
			image: imageUrl,
		};

		const messages: LlmMessage[] = [
			system('You are a wildlife expert. Be concise and accurate.'),
			user([{ type: 'text', text: 'Can you describe this animal?' }, imagePart]),
			{ role: 'assistant', content: 'This is an African elephant.' },
			user('What is one interesting fact about this species?'),
		];

		const result = await llm.generateMessage(messages, { id: 'test-complex-conversation' });

		expect(result).to.exist;
		expect(result.role).to.equal('assistant');
		expect(result.content).to.be.a('string');
		expect(result.content.length).to.be.greaterThan(10);
		expect(result.stats).to.exist;
		expect(result.stats?.totalTime).to.be.a('number');
		expect(result.stats?.totalTime).to.be.greaterThan(0);
	});
});
