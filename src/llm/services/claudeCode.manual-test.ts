/**
 * Manual integration test for ClaudeCode
 * Run with: node -r esbuild-register -r src/cli/envLoader.ts src/llm/services/claudeCode.manual-test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { system, user } from '#shared/llm/llm.model';
import type { ImagePartExt, LlmMessage } from '#shared/llm/llm.model';
import { claudeCodeSonnet } from './claudeCode';

async function testMultipleMessages() {
	console.log('\n=== Test 1: Multiple Messages ===');
	const llm = claudeCodeSonnet();

	const messages: LlmMessage[] = [
		system('You are a helpful assistant. Be concise.'),
		user('What is 2+2?'),
		{ role: 'assistant', content: '2+2 equals 4.' },
		user('What about 3+3?'),
	];

	console.log('Sending multiple message conversation...');
	const result = await llm.generateMessage(messages, { id: 'test-multiple-messages' });

	console.log('Response:', result.content);
	console.log('Stats:', {
		cost: result.stats?.cost,
		inputTokens: result.stats?.inputTokens,
		outputTokens: result.stats?.outputTokens,
		totalTime: result.stats?.totalTime,
	});

	if (typeof result.content === 'string' && result.content.toLowerCase().includes('6')) {
		console.log('✓ Test passed - response contains "6"');
	} else {
		console.log('✗ Test failed - response does not contain "6"');
	}
}

async function testImageInput() {
	console.log('\n=== Test 2: Image Input (Elephant) ===');
	console.log('Testing image support via --input-format stream-json with Anthropic API format.');

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
		user([imagePart, { type: 'text', text: 'What animal is in this image? Just give me the animal name.' }]),
	];

	console.log('Sending request with image...');
	const result = await llm.generateMessage(messages, { id: 'test-image-input' });

	console.log('Response:', result.content);
	console.log('Stats:', {
		cost: result.stats?.cost,
		inputTokens: result.stats?.inputTokens,
		outputTokens: result.stats?.outputTokens,
		totalTime: result.stats?.totalTime,
	});

	// Test passes if correctly identified elephant
	if (typeof result.content === 'string' && result.content.toLowerCase().includes('elephant')) {
		console.log('✓ Test passed - correctly identified elephant');
	} else {
		console.log('✗ Test failed - did not identify elephant. Response:', result.content);
	}
}

async function testComplexConversationWithImage() {
	console.log('\n=== Test 3: Complex Multi-Turn Conversation ===');
	const llm = claudeCodeSonnet();

	const messages: LlmMessage[] = [
		system('You are a wildlife expert. Be concise and accurate.'),
		user('Tell me about African elephants.'),
		{ role: 'assistant', content: 'African elephants are the largest land mammals, with distinctive large ears and long trunks.' },
		user('What is one interesting fact about this species?'),
	];

	console.log('Sending complex multi-turn conversation...');
	const result = await llm.generateMessage(messages, { id: 'test-complex-conversation' });

	console.log('Response:', result.content);
	console.log('Stats:', {
		cost: result.stats?.cost,
		inputTokens: result.stats?.inputTokens,
		outputTokens: result.stats?.outputTokens,
		totalTime: result.stats?.totalTime,
	});

	if (typeof result.content === 'string' && result.content.length > 10) {
		console.log('✓ Test passed - received substantial response');
	} else {
		console.log('✗ Test failed - response too short');
	}
}

async function main() {
	console.log('Starting ClaudeCode Manual Integration Tests...');
	console.log('This will make real API calls to Claude Code CLI\n');

	// Initialize in-memory context
	initInMemoryApplicationContext();

	try {
		await testMultipleMessages();
		await testImageInput();
		await testComplexConversationWithImage();

		console.log('\n=== All tests completed ===\n');
	} catch (error) {
		console.error('\n=== Test failed with error ===');
		console.error(error);
		process.exit(1);
	}
}

main();
