import fs from 'node:fs';
import { expect } from 'chai';
import { LlmMessage } from '#llm/llm';
import { Claude3_5_Sonnet } from '#llm/services/anthropic';
import { Claude3_5_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { cerebrasLlama3_8b } from '#llm/services/cerebras';
import { deepinfraQwQ_32B, deepinfraQwen2_5_Coder32B } from '#llm/services/deepinfra';
import { deepSeekV3 } from '#llm/services/deepseek';
import { fireworksLlama3_70B } from '#llm/services/fireworks';
import { groqLlama3_3_70B } from '#llm/services/groq';
import { nebiusDeepSeekR1 } from '#llm/services/nebius';
import { Ollama_Phi3 } from '#llm/services/ollama';
import { GPT4oMini } from '#llm/services/openai';
import { sambanovaDeepseekR1, sambanovaLlama3_3_70b, sambanovaLlama3_3_70b_R1_Distill } from '#llm/services/sambanova';
import { togetherLlama3_70B } from '#llm/services/together';
import { Gemini_2_0_Flash, Gemini_2_0_Flash_Lite, Gemini_2_0_Flash_Thinking, Gemini_2_5_Pro } from '#llm/services/vertexai';

const elephantBase64 = fs.readFileSync('test/llm/elephant.jpg', 'base64');
const pdfBase64 = fs.readFileSync('test/llm/purple.pdf', 'base64');

// Skip until API keys are configured in CI
describe('LLMs', () => {
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

	describe('Anthropic', () => {
		const llm = Claude3_5_Sonnet();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('should handle image attachments', async () => {
			const response = await llm.generateText(IMAGE_BASE64_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('elephant');
		});

		it('should handle PDF attachments', async () => {
			const response = await llm.generateText(PDF_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('purple');
		});
	});

	describe('Anthropic Vertex', () => {
		const llm = Claude3_5_Sonnet_Vertex();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('should handle image attachments', async () => {
			const response = await llm.generateText(IMAGE_BASE64_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('elephant');
		});

		it('should handle PDF attachments', async () => {
			const response = await llm.generateText(PDF_PROMPT, { temperature: 0 });
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
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Deepinfra', () => {
		it('Qwen2_5_Coder32B should generateText', async () => {
			const llm = deepinfraQwen2_5_Coder32B();
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('QwQ_32B should generateText', async () => {
			const llm = deepinfraQwQ_32B();
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Deepseek', () => {
		const llm = deepSeekV3();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Fireworks', () => {
		const llm = fireworksLlama3_70B();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Groq', () => {
		const llm = groqLlama3_3_70B();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Nebius', () => {
		const llm = nebiusDeepSeekR1();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Ollama', () => {
		const llm = Ollama_Phi3();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('OpenAI', () => {
		const llm = GPT4oMini();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('SambaNova', () => {
		it.skip('DeepSeek R1 should generateText', async () => {
			const response = await sambanovaDeepseekR1().generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('Llama 70b R1 Distill should generateText', async () => {
			const response = await sambanovaLlama3_3_70b_R1_Distill().generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('Llama 70b should generateText', async () => {
			const response = await sambanovaLlama3_3_70b().generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('Together', () => {
		const llm = togetherLlama3_70B();

		it('should generateText', async () => {
			const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});

	describe('VertexAI', () => {
		describe('Flash 2.0', () => {
			const llm = Gemini_2_0_Flash();

			it('should generateText', async () => {
				const response = await llm.generateText(SKY_PROMPT, { temperature: 0 });
				expect(response.toLowerCase()).to.include('blue');
			});

			it('should handle image attachments', async () => {
				const response = await llm.generateText(IMAGE_BASE64_PROMPT, { temperature: 0 });
				expect(response.toLowerCase()).to.include('elephant');
			});

			it('should handle PDF attachments', async () => {
				const response = await llm.generateText(PDF_PROMPT, { temperature: 0 });
				expect(response.toLowerCase()).to.include('purple');
			});
		});

		it.skip('Gemini 2.5 Pro should generateText', async () => {
			const response = await Gemini_2_5_Pro().generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('Gemini 2.0 Flash Lite should generateText', async () => {
			const response = await Gemini_2_0_Flash_Lite().generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});

		it('Gemini 2.0 thinking experimental should generateText', async () => {
			const response = await Gemini_2_0_Flash_Thinking().generateText(SKY_PROMPT, { temperature: 0 });
			expect(response.toLowerCase()).to.include('blue');
		});
	});
});
