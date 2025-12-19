/**
 * Integration tests for JSON Schema function definitions with Vercel AI SDK tool calling
 *
 * Tests the end-to-end flow of:
 * 1. Generating JSON Schema from function decorators
 * 2. Converting to Vercel AI SDK tool format
 * 3. Making actual LLM tool calls using Claude 4.5 Haiku (via Vertex AI)
 */

import { generateText, jsonSchema, stepCountIs, tool } from 'ai';
import { expect } from 'chai';
import { z } from 'zod';
import { appContext } from '#app/applicationContext';
import { AiLLM } from '#llm/services/ai-llm';
import { anthropicClaude4_5_Haiku } from '#llm/services/anthropic';
import { Claude4_5_Haiku_Vertex } from '#llm/services/anthropic-vertex';
import { fireworksKimi2thinking } from '#llm/services/fireworks';
import { vertexGemini_3_0_Flash } from '#llm/services/vertexai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { func, funcClass } from './functionDecorators';
import { functionSchemaParser } from './functionSchemaParser';
import {
	functionSchemaToJsonSchemaParameters,
	functionSchemaToJsonSchemaToolDefinition,
	functionSchemasToJsonSchemaToolDefinitions,
	typeToJsonSchema,
} from './functionSchemaToJsonSchema';
import type { FunctionJsonSchema, JsonSchemaParameters } from './functions';

// Test function class with various parameter types
@funcClass(__filename)
class WeatherService {
	/**
	 * Get the current weather for a location
	 * @param city The city name
	 * @param country The country code (e.g., US, UK)
	 * @returns Weather information
	 */
	@func()
	async getWeather(city: string, country: string): Promise<string> {
		return `Weather in ${city}, ${country}: Sunny, 22°C`;
	}

	/**
	 * Get weather forecast for multiple days
	 * @param city The city name
	 * @param days Number of days to forecast
	 * @returns Array of forecast data
	 */
	@func()
	async getForecast(city: string, days: number): Promise<string[]> {
		return Array.from({ length: days }, (_, i) => `Day ${i + 1}: Sunny`);
	}
}

@funcClass(__filename)
class CalculatorService {
	/**
	 * Add two numbers together
	 * @param a The first number
	 * @param b The second number
	 * @returns The sum of a and b
	 */
	@func()
	add(a: number, b: number): number {
		return a + b;
	}

	/**
	 * Multiply two numbers
	 * @param a The first number
	 * @param b The second number
	 * @returns The product of a and b
	 */
	@func()
	multiply(a: number, b: number): number {
		return a * b;
	}
}

describe('JSON Schema Tool Calling Integration', () => {
	setupConditionalLoggerOutput();

	let weatherSchemas: Record<string, FunctionJsonSchema>;
	let calculatorSchemas: Record<string, FunctionJsonSchema>;

	before(async () => {
		await appContext().userService.ensureSingleUser();
		weatherSchemas = functionSchemaParser(__filename);
		calculatorSchemas = functionSchemaParser(__filename);
	});

	describe('Schema Generation', () => {
		it('should generate valid JSON Schema for WeatherService', () => {
			const schema = weatherSchemas.WeatherService_getWeather;
			expect(schema).to.exist;
			expect(schema.inputSchema).to.exist;
			expect(schema.inputSchema.type).to.equal('object');
			expect(schema.inputSchema.properties.city).to.deep.equal({
				type: 'string',
				description: 'The city name',
			});
			expect(schema.inputSchema.properties.country).to.deep.equal({
				type: 'string',
				description: 'The country code (e.g., US, UK)',
			});
			expect(schema.inputSchema.required).to.deep.equal(['city', 'country']);
		});

		it('should generate valid JSON Schema for CalculatorService', () => {
			const schema = calculatorSchemas.CalculatorService_add;
			expect(schema).to.exist;
			expect(schema.inputSchema).to.exist;
			expect(schema.inputSchema.properties.a).to.deep.equal({
				type: 'number',
				description: 'The first number',
			});
			expect(schema.inputSchema.properties.b).to.deep.equal({
				type: 'number',
				description: 'The second number',
			});
		});

		it('should convert to OpenAI/Anthropic tool definition format', () => {
			const schema = weatherSchemas.WeatherService_getWeather;
			const toolDef = functionSchemaToJsonSchemaToolDefinition(schema);

			expect(toolDef.type).to.equal('function');
			expect(toolDef.function.name).to.equal('WeatherService_getWeather');
			expect(toolDef.function.description).to.equal('Get the current weather for a location');
			expect(toolDef.function.parameters.type).to.equal('object');
		});
	});

	/**
	 * VERTEX AI TOOL CALLING - BLOCKED BY SDK BUG
	 *
	 * Status: Tests skipped due to unresolved bugs in Vercel AI SDK Vertex providers.
	 *
	 * Tested configurations (all fail):
	 * - AI SDK v5 stable + Zod v3: fails
	 * - AI SDK v5 stable + Zod v4: fails
	 * - AI SDK v6 beta + Zod v3: fails
	 * - AI SDK v6 beta + Zod v4: fails
	 *
	 * Provider-specific errors:
	 * - Gemini via Vertex: "functionDeclaration parameters schema should be of type OBJECT"
	 * - Claude via Vertex: "input_schema.type: Field required"
	 * - Direct Anthropic API: WORKS (schema passes, fails on low credits)
	 *
	 * Root cause: GitHub PR #9762 (fix for Vertex AI tool schema extraction) is still open
	 * with failing tests and has not been merged.
	 *
	 * Workaround: Use direct provider APIs instead of Vertex variants:
	 * - anthropicClaude4_5_Haiku() instead of Claude4_5_Haiku_Vertex()
	 * - Use GEMINI_API_KEY with @ai-sdk/google instead of @ai-sdk/google-vertex
	 */
	describe.skip('Vercel AI SDK Tool Calling with Vertex AI (blocked by SDK bug)', () => {
		const llm = vertexGemini_3_0_Flash() as AiLLM<any>;

		it('should make a tool call for weather lookup', async function () {
			this.timeout(30000);

			const weatherTool = tool({
				description: 'Get the current weather for a location',
				inputSchema: z.object({
					city: z.string().describe('The city name'),
					country: z.string().describe('The country code'),
				}),
				execute: async ({ city, country }) => {
					return `Weather in ${city}, ${country}: Sunny, 22°C`;
				},
			});

			const result = await generateText({
				model: llm.aiModel(),
				tools: { getWeather: weatherTool },
				prompt: 'What is the weather like in London, UK?',
				stopWhen: stepCountIs(2),
			});

			expect(result.toolCalls).to.exist;
			expect(result.toolCalls.length).to.be.greaterThan(0);

			const toolCall = result.toolCalls[0];
			expect(toolCall.toolName).to.equal('getWeather');
			expect((toolCall.input as { city: string }).city.toLowerCase()).to.include('london');
		});

		it('should make a tool call for calculator', async function () {
			this.timeout(30000);

			const addTool = tool({
				description: 'Add two numbers together',
				inputSchema: z.object({
					a: z.number().describe('The first number'),
					b: z.number().describe('The second number'),
				}),
				execute: async ({ a, b }) => {
					return a + b;
				},
			});

			const result = await generateText({
				model: llm.aiModel(),
				tools: { add: addTool },
				prompt: 'What is 42 plus 58?',
				stopWhen: stepCountIs(2),
			});

			expect(result.toolCalls).to.exist;
			expect(result.toolCalls.length).to.be.greaterThan(0);

			const toolCall = result.toolCalls[0];
			expect(toolCall.toolName).to.equal('add');
			expect((toolCall.input as { a: number; b: number }).a).to.equal(42);
			expect((toolCall.input as { a: number; b: number }).b).to.equal(58);
			expect(result.text).to.include('100');
		});

		it('should handle multiple tools and select the correct one', async function () {
			this.timeout(30000);

			const addTool = tool({
				description: 'Add two numbers together',
				inputSchema: z.object({
					a: z.number().describe('The first number'),
					b: z.number().describe('The second number'),
				}),
				execute: async ({ a, b }) => a + b,
			});

			const multiplyTool = tool({
				description: 'Multiply two numbers',
				inputSchema: z.object({
					a: z.number().describe('The first number'),
					b: z.number().describe('The second number'),
				}),
				execute: async ({ a, b }) => a * b,
			});

			const result = await generateText({
				model: llm.aiModel(),
				tools: { add: addTool, multiply: multiplyTool },
				prompt: 'What is 7 multiplied by 8?',
				stopWhen: stepCountIs(2),
			});

			expect(result.toolCalls).to.exist;
			expect(result.toolCalls.length).to.be.greaterThan(0);

			const toolCall = result.toolCalls[0];
			expect(toolCall.toolName).to.equal('multiply');
			expect((toolCall.input as { a: number; b: number }).a).to.equal(7);
			expect((toolCall.input as { a: number; b: number }).b).to.equal(8);
			expect(result.text).to.include('56');
		});
	});

	describe('JSON Schema to Zod Conversion', () => {
		it('should convert string type correctly', () => {
			const jsonSchema = typeToJsonSchema('string');
			expect(jsonSchema.type).to.equal('string');
		});

		it('should convert number type correctly', () => {
			const jsonSchema = typeToJsonSchema('number');
			expect(jsonSchema.type).to.equal('number');
		});

		it('should convert array type correctly', () => {
			const jsonSchema = typeToJsonSchema('string[]');
			expect(jsonSchema.type).to.equal('array');
			expect(jsonSchema.items).to.deep.equal({ type: 'string' });
		});

		it('should convert enum type correctly', () => {
			const jsonSchema = typeToJsonSchema("'read' | 'write' | 'delete'");
			expect(jsonSchema.type).to.equal('string');
			expect(jsonSchema.enum).to.deep.equal(['read', 'write', 'delete']);
		});
	});

	// Also blocked by Vertex AI SDK bug - see note above
	describe.skip('Dynamic Tool Creation from Function Schema (blocked by SDK bug)', () => {
		it('should create working tools from parsed function schemas', async function () {
			this.timeout(30000);

			const schema = calculatorSchemas.CalculatorService_add;

			// Use our generated inputSchema directly with jsonSchema()
			// This demonstrates the integration between our function schema system and Vercel AI SDK
			const calculator = new CalculatorService();
			const dynamicTool = tool({
				description: schema.description,
				inputSchema: jsonSchema<{ a: number; b: number }>(schema.inputSchema),
				execute: async ({ a, b }) => calculator.add(a, b),
			});

			const result = await generateText({
				model: (vertexGemini_3_0_Flash() as AiLLM<any>).aiModel(),
				tools: { [schema.name]: dynamicTool },
				prompt: 'Calculate 15 + 27',
				stopWhen: stepCountIs(2),
			});

			expect(result.toolCalls).to.exist;
			expect(result.toolCalls.length).to.be.greaterThan(0);
			expect(result.text).to.include('42');
		});
	});
});
