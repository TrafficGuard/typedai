import fs from 'node:fs';
import { expect } from 'chai';
import { Claude3_5_Sonnet } from '#llm/services/anthropic';
import { Claude4_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { cerebrasLlama3_8b } from '#llm/services/cerebras';
import { deepinfraDeepSeekR1, deepinfraQwen3_235B_A22B } from '#llm/services/deepinfra';
import { deepSeekV3 } from '#llm/services/deepseek';
import { fireworksLlama3_70B } from '#llm/services/fireworks';
import { groqLlama3_3_70B } from '#llm/services/groq';
import { nebiusDeepSeekR1 } from '#llm/services/nebius';
import { Ollama_Phi3 } from '#llm/services/ollama';
import { GPT41mini } from '#llm/services/openai';
import { perplexityLLM } from '#llm/services/perplexity-llm';
import { sambanovaDeepseekR1, sambanovaLlama3_3_70b, sambanovaLlama3_3_70b_R1_Distill } from '#llm/services/sambanova';
import { togetherLlama3_70B } from '#llm/services/together';
import { vertexGemini_2_0_Flash_Lite, vertexGemini_2_5_Flash, vertexGemini_2_5_Flash_Lite, vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import type { LlmMessage } from '#shared/llm/llm.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';

const elephantBase64 = fs.readFileSync('test/llm/purple.jpg', 'base64');
const pdfBase64 = fs.readFileSync('test/llm/document.pdf', 'base64');

// Skip until API keys are configured in CI
describe('LLMs', () => {
	setupConditionalLoggerOutput();
	const SKY_PROMPT: LlmMessage[] = [
		{
			role: 'system',
			content: 'Answer in one word.',
		},
		{
			role: 'user',
			content: 'What planet do we live on?',
		},
		{
			role: 'assistant',
			content: 'Earth',
		},
		{
			role: 'user',
			content: 'What colour is the day sky? (Hint: starts with b)',
		},
	];

	const IMAGE_BASE64_PROMPT: LlmMessage[] = [
		{
			role: 'user',
			content: [
				{ type: 'text', text: 'What type of animal is in this image?' },
				{ type: 'image', image: elephantBase64, mimeType: 'image/jpeg' },
			],
		},
	];

	const PDF_PROMPT: LlmMessage[] = [
		{
			role: 'user',
			content: [
				{ type: 'text', text: 'What is the content of this PDF file?' },
				{ type: 'file', data: pdfBase64, mimeType: 'application/pdf' },
			],
		},
	];

	describe('Perplexity', () => {
		const llm = perplexityLLM();

		it('should generateText', async () => {
			const response = await llm.generateText('why is the sky blue?', { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Anthropic', () => {
		const llm = Claude3_5_Sonnet();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('should handle image attachments', async () => {
			const response = await llm.generateText(IMAGE_BASE64_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('elephant');
		});

		it('should handle PDF attachments', async () => {
			const response = await llm.generateText(PDF_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('purple');
		});
	});

	describe('Anthropic Vertex', () => {
		const llm = Claude4_Sonnet_Vertex();

		it('should have thinking', async () => {
			const response: LlmMessage = await llm.generateMessage(SKY_PROMPT, { temperature: 0, id: 'test', thinking: 'high' });
			const content = response.content;
			expect(Array.isArray(content)).to.be.true;
			if (Array.isArray(content)) {
				expect(content.find((c) => c.type === 'reasoning')).to.not.be.undefined;
				expect(content.find((c) => c.type === 'text').text.toLowerCase()).to.include('blue');
			}
		});

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('should handle image attachments', async () => {
			const response = await llm.generateText(IMAGE_BASE64_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('elephant');
		});

		it('should handle PDF attachments', async () => {
			const response = await llm.generateText(PDF_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('purple');
		});

		// it('should cache messages', async () => {
		// 	const response = await llm.generateText([
		// 		{
		// 			role: ''
		// 		}
		// 	], { temperature: 0 });
		// 	expect(response.toLowerCase()).to.include('purple');
		// });
	});

	describe('Cerebras', () => {
		const llm = cerebrasLlama3_8b();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Deepinfra', () => {
		it('Qwen3_235B_A22B should generateText', async () => {
			const llm = deepinfraQwen3_235B_A22B();
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('DeepSeek R1 should generateText', async () => {
			const llm = deepinfraDeepSeekR1();
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Deepseek', () => {
		const llm = deepSeekV3();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Fireworks', () => {
		const llm = fireworksLlama3_70B();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Groq', () => {
		const llm = groqLlama3_3_70B();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Nebius', () => {
		const llm = nebiusDeepSeekR1();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Ollama', () => {
		const llm = Ollama_Phi3();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('OpenAI', () => {
		const llm = GPT41mini();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('SambaNova', () => {
		it.skip('DeepSeek R1 should generateText', async () => {
			const response = await sambanovaDeepseekR1().generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('Llama 70b R1 Distill should generateText', async () => {
			const response = await sambanovaLlama3_3_70b_R1_Distill().generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('Llama 70b should generateText', async () => {
			const response = await sambanovaLlama3_3_70b().generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Together', () => {
		const llm = togetherLlama3_70B();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('VertexAI', () => {
		describe('Flash 2.5', () => {
			const llm = vertexGemini_2_5_Flash();

			it('should generateText', async () => {
				const response = await llm.generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
				expect(response.toLowerCase()).to.include('blue');
			});

			it('should handle image attachments', async () => {
				const response = await llm.generateText(IMAGE_BASE64_PROMPT, { temperature: 0, id: 'test' });
				expect(response.toLowerCase()).to.include('elephant');
			});

			it('should handle PDF attachments', async () => {
				const response = await llm.generateText(PDF_PROMPT, { temperature: 0, id: 'test' });
				expect(response.toLowerCase()).to.include('purple');
			});
		});

		it('Gemini 2.5 Pro should generateText', async () => {
			const response = await vertexGemini_2_5_Pro().generateText(SKY_PROMPT, { temperature: 0, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('Gemini 2.0 Flash Lite should generateText', async () => {
			const response = await vertexGemini_2_0_Flash_Lite().generateText(SKY_PROMPT, { temperature: 0.1, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});

		it.skip('Gemini 2.5 Flash Lite should generateText', async () => {
			const response = await vertexGemini_2_5_Flash_Lite().generateText(SKY_PROMPT, { temperature: 0.1, id: 'test' });
			expect(response.toLowerCase()).to.include('blue');
		});
	});
});
