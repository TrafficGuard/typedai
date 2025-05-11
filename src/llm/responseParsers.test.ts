import { expect } from 'chai';

// Import extractReasoningAndJson
import { extractJsonResult, extractReasoningAndJson, extractTag, parseFunctionCallsXml } from './responseParsers';

describe('responseParsers', () => {
	describe('extractJsonResult', () => {
		// TODO handle when the json is indented

		it('Should extract when only JSON', async () => {
			const object = extractJsonResult('{ "foo": "bar" }');
			expect(object).to.deep.equal({ foo: 'bar' });
		});

		it('Should extract when there is some chat before', async () => {
			const object = extractJsonResult('Here is your JSON: { "foo": "bar" }');
			expect(object).to.deep.equal({ foo: 'bar' });
		});

		it('Should extract the Markdown formatted JSON when there is other text preceding it', async () => {
			const object = extractJsonResult(`something. reasoning from the LLM
\`\`\`json
{ "foo": "bar" }
\`\`\``);
			expect(object).to.deep.equal({ foo: 'bar' });
		});

		it('Should extract the Markdown formatted JSON when there is other text preceding it including triple ticks', async () => {
			const object = extractJsonResult(`\`\`\`think\nsomething. reasoning from the LLM
\`\`\`json
{ "foo": "bar" }
\`\`\``);
			expect(object).to.deep.equal({ foo: 'bar' });
		});

		it('Should extract the JSON when there is <json> tags and json markdown', async () => {
			const object = extractJsonResult(`reasoning from the LLM
			<json>
\`\`\`json
{ "foo": "bar" }
\`\`\`
</json>`);
			expect(object).to.deep.equal({ foo: 'bar' });
		});

		it('Should extract the JSON when there is other text preceding it and Markdown type is uppercase JSON', async () => {
			const object = extractJsonResult(`reasoning from the LLM
\`\`\`JSON
{ "foo": "bar" }
\`\`\``);
			expect(object).to.deep.equal({ foo: 'bar' });
		});

		it('Should extract the JSON when its wrapped in <json></json> elements', async () => {
			const object = extractJsonResult(`reasoning from the LLM
<json>
{ "foo": "bar" }
</json>`);
		});

		it('Should extract the JSON when its wrapped in <json></json> elements', async () => {
			const object = extractJsonResult(`<json>
[
	{
	"url": "https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/gemini",
	"title": "Gemini API | Generative AI on Vertex AI"
	}
]
</json>`);
			expect(object[0].url).to.equal('https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/gemini');
		});
	});

	describe('extractTagResult', () => {
		it('Should extract contents in <result></result> tag', async () => {
			const result = `<result>
							Some result
							</result>`;
			const object = extractTag(result, 'result');
			expect(object).to.deep.equal('Some result');
		});
	});

	describe('parseFunctionCallsXml', () => {
		it('Should parse XML string and return a function call object with parameters as either ', async () => {
			const xmlString = `<function_calls>
                <function_call>
                    <function_name>testTool</function_name>
                    <parameters>
                        <param1>value1</param1>
                        <param2>value2</param2>
                    </parameters>
                </function_call>
                <function_call>
                    <function_name>testTool2</function_name>
                    <parameters>
                        <param1>value3</param1>
                    </parameters>
                </function_call>
            </function_calls>`;

			const parsedData = parseFunctionCallsXml(xmlString);

			expect(parsedData.functionCalls).to.have.lengthOf(2);

			expect(parsedData.functionCalls[0]).to.deep.equal({
				function_name: 'testTool',
				parameters: {
					param1: 'value1',
					param2: 'value2',
				},
			});

			expect(parsedData.functionCalls[1]).to.deep.equal({
				function_name: 'testTool2',
				parameters: {
					param1: 'value3',
				},
			});
		});

		it('Should ignore prior <function_calls>', async () => {
			const xmlString = `
			<planning_output>
				<!-- this is ignored -->
				<function_calls>
					<function_call>
						<function_name>testTool</function_name>
						<parameters>
							<abc>xyz</abc>
						</parameters>
					</function_call>
				</function_calls>
			</planning_output>
			
			<function_calls>
                <function_call>
                    <function_name>testTool</function_name>
                    <parameters>
                        <param1>value1</param1>
                        <param2>value2</param2>
                    </parameters>
                </function_call>
                <function_call>
                    <function_name>testTool2</function_name>
                    <parameters>
                        <param1>value3</param1>
                    </parameters>
                </function_call>
            </function_calls>`;

			const parsedData = parseFunctionCallsXml(xmlString);

			expect(parsedData.functionCalls).to.have.lengthOf(2);

			expect(parsedData.functionCalls[0]).to.deep.equal({
				function_name: 'testTool',
				parameters: {
					param1: 'value1',
					param2: 'value2',
				},
			});

			expect(parsedData.functionCalls[1]).to.deep.equal({
				function_name: 'testTool2',
				parameters: {
					param1: 'value3',
				},
			});
		});
	});

	describe('extractReasoningAndJson', () => {
		it('Should extract reasoning and JSON from markdown format', () => {
			const text = 'This is some reasoning.\n```json\n{ "foo": "bar" }\n```';
			const result = extractReasoningAndJson<{ foo: string }>(text);
			expect(result.reasoning).to.equal('This is some reasoning.');
			expect(result.object).to.deep.equal({ foo: 'bar' });
			expect(result.jsonString).to.equal('{ "foo": "bar" }');
		});

		it('Should extract reasoning and JSON from XML format', () => {
			const text = 'This is XML reasoning.\n<json>\n{ "baz": 123 }\n</json>';
			const result = extractReasoningAndJson<{ baz: number }>(text);
			expect(result.reasoning).to.equal('This is XML reasoning.');
			expect(result.object).to.deep.equal({ baz: 123 });
			expect(result.jsonString).to.equal('{ "baz": 123 }');
		});

		it('Should extract reasoning and JSON from XML containing markdown JSON', () => {
			const text = 'XML with MD reasoning.\n<json>\n```json\n{ "data": true }\n```\n</json>';
			const result = extractReasoningAndJson<{ data: boolean }>(text);
			expect(result.reasoning).to.equal('XML with MD reasoning.');
			expect(result.object).to.deep.equal({ data: true });
			expect(result.jsonString).to.equal('{ "data": true }');
		});

		it('Should handle no reasoning, just markdown JSON', () => {
			const text = '```json\n{ "only": "json" }\n```';
			const result = extractReasoningAndJson<{ only: string }>(text);
			expect(result.reasoning).to.equal('');
			expect(result.object).to.deep.equal({ only: 'json' });
			expect(result.jsonString).to.equal('{ "only": "json" }');
		});

		it('Should handle no reasoning, just XML JSON', () => {
			const text = '<json>\n{ "xmlOnly": "data" }\n</json>';
			const result = extractReasoningAndJson<{ xmlOnly: string }>(text);
			expect(result.reasoning).to.equal('');
			expect(result.object).to.deep.equal({ xmlOnly: 'data' });
			expect(result.jsonString).to.equal('{ "xmlOnly": "data" }');
		});

		it('Should handle plain JSON string as input (no reasoning)', () => {
			const text = '{ "plain": true }';
			const result = extractReasoningAndJson<{ plain: boolean }>(text);
			expect(result.reasoning).to.equal('');
			expect(result.object).to.deep.equal({ plain: true });
			expect(result.jsonString).to.equal('{ "plain": true }');
		});

		it('Should throw SyntaxError for malformed JSON in markdown block', () => {
			const text = 'Reasoning.\n```json\n{ "foo": "bar", \n```'; // Malformed
			expect(() => extractReasoningAndJson(text)).to.throw(SyntaxError, /Failed to parse JSON content/);
		});

		it('Should throw SyntaxError for malformed JSON in XML block', () => {
			const text = 'Reasoning.\n<json>\n{ "foo": "bar", \n</json>'; // Malformed
			expect(() => extractReasoningAndJson(text)).to.throw(SyntaxError, /Failed to parse JSON content/);
		});

		it('Should throw Error if no JSON block is found and text is not plain JSON', () => {
			const text = 'This is just some text without any JSON.';
			expect(() => extractReasoningAndJson(text)).to.throw(Error, 'Failed to extract structured JSON.');
		});

		it('Should handle JSON with leading/trailing whitespace within blocks', () => {
			const text = 'Reasoning. ```json  \n  { "ws": "test" }  \n  ```  ';
			const result = extractReasoningAndJson<{ ws: string }>(text);
			expect(result.reasoning).to.equal('Reasoning.');
			expect(result.object).to.deep.equal({ ws: 'test' });
			expect(result.jsonString).to.equal('{ "ws": "test" }');
		});

		it('Should correctly parse if JSON block is not at the very end but is the last structured block', () => {
			// Current regexes with `$` will fail this if there's text after the block.
			// This test clarifies the behavior: it expects the block to be effectively last.
			const textWithTrailing = 'Reasoning. ```json{ "key": "val" }``` Some other text.';
			const result = extractReasoningAndJson<{ key: string }>(textWithTrailing);
			expect(result.reasoning).to.equal('Reasoning.');
			expect(result.object).to.deep.equal({ key: 'val' });
			expect(result.jsonString).to.equal('{ "key": "val" }');
		});

		// Add a new test case for the specific scenario mentioned by the user with XML and trailing </thought>
		it('Should correctly parse XML JSON block with trailing text like </thought>', () => {
			const textWithTrailingThought =
				'<think>\nSome thoughts here.\n</think>\n<json>\n{\n  "inspectFiles": [\n    "production/lb.tf"\n  ]\n}\n</json>\n</thought>';
			const result = extractReasoningAndJson<{ inspectFiles: string[] }>(textWithTrailingThought);
			expect(result.reasoning).to.equal('<think>\nSome thoughts here.\n</think>');
			expect(result.object).to.deep.equal({ inspectFiles: ['production/lb.tf'] });
			expect(result.jsonString).to.equal('{\n  "inspectFiles": [\n    "production/lb.tf"\n  ]\n}');
		});
	});
});
