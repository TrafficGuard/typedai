import { type FunctionDeclarationSchema, FunctionDeclarationSchemaType, type Tool } from '@google-cloud/vertexai';
import type { FunctionParameter, FunctionSchema } from '#functionSchema/functions';

function convertFunctionParameterToFunctionDeclarationSchema(functionParameter: FunctionParameter): FunctionDeclarationSchema {
	const properties: { [key: string]: any } = {};

	properties[functionParameter.name] = {
		type: convertTypeToFunctionDeclarationSchemaType(functionParameter.type),
		description: functionParameter.description,
	};

	return {
		type: FunctionDeclarationSchemaType.OBJECT,
		properties: properties,
		required: [functionParameter.name],
	};
}

function convertTypeToFunctionDeclarationSchemaType(type: string): FunctionDeclarationSchemaType {
	switch (type) {
		case 'string':
			return FunctionDeclarationSchemaType.STRING;
		case 'number':
			return FunctionDeclarationSchemaType.NUMBER;
		case 'string[]':
			return FunctionDeclarationSchemaType.ARRAY;
		default:
			throw new Error(`Unsupported type: ${type}`);
	}
}

export function convertFunctionDefinitionsToTool(functionSchemas: FunctionSchema[]): Tool {
	const functionDeclarations = functionSchemas.map((functionDefinition) => {
		const parameters: FunctionDeclarationSchema = {
			type: FunctionDeclarationSchemaType.OBJECT,
			properties: {},
			required: [],
		};

		functionDefinition.parameters?.forEach((parameter) => {
			const parameterSchema = convertFunctionParameterToFunctionDeclarationSchema(parameter);
			parameters.properties[parameter.name] = parameterSchema.properties[parameter.name];
			parameters.required?.push(parameter.name);
		});

		return {
			name: functionDefinition.name,
			description: functionDefinition.description,
			parameters: parameters,
		};
	});

	return {
		functionDeclarations: functionDeclarations,
	};
}
