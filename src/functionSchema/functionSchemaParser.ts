import { readFileSync, writeFileSync } from 'fs';
import fs, { writeFile } from 'node:fs';
import path, { join } from 'path';
import { promisify } from 'util';
import { ClassDeclaration, Decorator, JSDoc, JSDocTag, MethodDeclaration, ParameterDeclaration, Project, Type } from 'ts-morph';
import { FUNC_DECORATOR_NAME } from '#functionSchema/functionSchemaTypes';
import { logger } from '#o11y/logger';
import { systemDir } from '../appVars';
import { FunctionParameter, FunctionSchema } from './functions';

const writeFileAsync = promisify(writeFile);

const CACHED_BASE_PATH = `${systemDir()}/functions/`;

/**
 * Parses a source file which is expected to have a class with the @funClass decorator.
 *
 * The JSON function schema is cached to file to avoid the overhead of ts-morph on startup.
 *
 * With the example class:
 * <code>
 * \@funcClass(__filename)
 * export class FuncClass {
 *    /**
 *     * Description of simple method
 *     *\/
 *    \@func()
 *    simpleMethod(): void {}
 *
 *   /**
 *     * Description of complexMethod
 *     * \@param {string} arg1 the first arg
 *     * \@param {number} arg2 the second arg
 *     * \@return Promise<Date> the current date
 *     *\/
 *    \@func()
 *    async complexMethod(arg1: string, arg2?: number): Promise<Date> {
 *        return new Date()
 *    }
 * }
 * </code>
 * Then the parsed result would be:
 * {
 * 	 "FuncClass_simpleMethod": {
 *      "name": "FuncClass_simpleMethod",
 *      "class": "FuncClass",
 *      "description": "Description of simple method",
 *      "returns": "",
 *      "params": []
 *    },
 * 	  "FuncClass_complexMethod": {
 *      "name": "FuncClass_complexMethod",
 *      "class": "FuncClass",
 *      "description": "Description of complexMethod",
 *      "returns": "Date - the current date",
 *      "params": [
 *          {
 *          	"name": "arg1",
 *          	"type": "string",
 *          	"description": "the first arg"
 *          },
 *          {
 *            "name": "arg2",
 *            "type": "string",
 *            "description": "the second arg",
 *            "optional": true
 *          }
 *      ]
 *   }
 * }
 * @param {string} sourceFilePath the full path to the source file
 * @returns An array of FunctionSchema objects
 */
export function functionSchemaParser(sourceFilePath: string): Record<string, FunctionSchema> {
	const cwd = process.cwd();
	let cachedPath = path.relative(cwd, sourceFilePath);
	// trim the .ts file extension
	cachedPath = cachedPath.slice(0, cachedPath.length - 3);
	cachedPath = path.join(CACHED_BASE_PATH, cachedPath);

	const sourceUpdatedTimestamp = getFileUpdatedTimestamp(sourceFilePath);
	const jsonUpdatedTimestamp = getFileUpdatedTimestamp(`${cachedPath}.json`);

	// If the cached schemas are newer than the source file, then we can use them
	if (jsonUpdatedTimestamp && jsonUpdatedTimestamp > sourceUpdatedTimestamp) {
		try {
			const json = readFileSync(`${cachedPath}.json`).toString();
			if (logger) logger.debug(`Loading cached function schemas from ${cachedPath}.json`);
			return JSON.parse(json);
		} catch (e) {
			if (logger) logger.info(`Error loading cached function schemas: ${e.message}`);
			else console.log(`Error loading cached function schemas: ${e.message}`);
		}
	}

	logger.info(`Generating schema for ${sourceFilePath}`);
	const project = new Project();
	// create the temp file in the same dir as the source file so the imports are resolved
	const tempPath = join(sourceFilePath, '..', 'temp.ts');
	const sourceFile = project.createSourceFile(tempPath, readFileSync(sourceFilePath, 'utf8'));

	const classes = sourceFile.getClasses();

	const functionSchemas: Record<string, FunctionSchema> = {};

	classes.forEach((cls: ClassDeclaration) => {
		const className = cls.getName();

		cls.getMethods().forEach((method: MethodDeclaration) => {
			const methodName = method.getName();
			const methodDescription = method.getJsDocs()[0]?.getDescription().trim();

			const hasFuncDecorator = method.getDecorators().some((decorator: Decorator) => decorator.getName() === FUNC_DECORATOR_NAME);
			if (!hasFuncDecorator) return;

			if (method.getJsDocs().length === 0) {
				logger.warn(`No JSDocs found for ${methodName}. Skipping function schema`);
				return;
			}

			const jsDocs: JSDoc = method.getJsDocs()[0];
			let returns = '';
			let returnType = '';
			const paramDescriptions = {};
			let paramIndex = 0;
			jsDocs.getTags().forEach((tag: JSDocTag) => {
				if (tag.getTagName() === 'returns' || tag.getTagName() === 'return') {
					returnType = method.getReturnType().getText();
					// Remove Promise wrapper if present
					if (returnType.startsWith('Promise<') && returnType.endsWith('>')) {
						returnType = returnType.slice(8, -1);
					}

					returns = tag.getText().replace('@returns', '').replace('@return', '').trim();
					// Remove type information from returns if present
					if (returns.startsWith('{') && returns.includes('}')) {
						returns = returns.slice(returns.indexOf('}') + 1).trim();
					}
					if (returns.length) {
						returns = returns.charAt(0).toUpperCase() + returns.slice(1);
					}
				}
				if (tag.getTagName() === 'param') {
					// For a @param tag the getText() should be in the format
					// @param {number} a - The first number to add.
					// We will handle the type (e.g. {number}) being optional, as it's not required.
					// And handle the dash "-" separator being optional
					// The @params must be in the same order and have the same name as the function arguments

					const text = tag.getText().trim();

					// remove the @param tag
					let descriptionParts = text.split(' ').slice(1);
					// remove the type if there is one
					if (descriptionParts[0].startsWith('{')) {
						const closingBrace = descriptionParts.findIndex((value) => value.trim().endsWith('}'));
						descriptionParts = descriptionParts.slice(closingBrace + 1);
					}
					// Remove the arg name, which must match the actual argument name
					const argName = method.getParameters()[paramIndex]?.getName();
					if (descriptionParts[0].trim() === argName) {
						descriptionParts = descriptionParts.slice(1);
						paramIndex++;
					} else {
						throw new Error(`JSDoc param name ${descriptionParts[0]} does not match arg name ${argName}`);
					}
					if (descriptionParts[0] === '-') {
						descriptionParts = descriptionParts.slice(1);
					}
					let description = descriptionParts.join(' ');
					if (description.endsWith('*')) {
						description = description.slice(0, -1).trim();
					}
					if (description.length) {
						description = description.charAt(0).toUpperCase() + description.slice(1);
					}
					logger.debug(`Parsed description for ${className}_${methodName}.${argName} to be: ${description}`);
					paramDescriptions[argName] = description;
				}
			});

			const parameterDeclarations: ParameterDeclaration[] = method.getParameters();
			const params: FunctionParameter[] = [];
			parameterDeclarations.forEach((param, index) => {
				const paramDef: FunctionParameter = {
					index,
					name: param.getName(),
					type: param.getType().getText(),
					description: paramDescriptions[param.getName()] || '',
				};
				if (param.isOptional() || param.hasInitializer()) {
					paramDef.optional = true;
				}
				if (paramDef.description) {
					params.push(paramDef);
				} else {
					logger.info(`No description for param ${className}_${methodName}.${param.getName()}`);
				}
			});

			const funcDef: FunctionSchema = {
				class: className,
				name: `${className}_${methodName}`,
				description: methodDescription,
				parameters: params,
			};
			if (returnType && returnType !== 'void') {
				funcDef.returnType = returnType;
				if (returns) funcDef.returns = returns;
			}
			functionSchemas[funcDef.name] = funcDef;
		});
	});
	fs.mkdirSync(path.join(cachedPath, '..'), { recursive: true });
	writeFileAsync(`${cachedPath}.json`, JSON.stringify(functionSchemas, null, 2)).catch((e) => logger.info(`Error writing cached schema: ${e.message}`));
	return functionSchemas;
}

function getFileUpdatedTimestamp(filePath: string): Date | null {
	try {
		const stats = fs.statSync(filePath); // Get the stats object
		return stats.mtime; // mtime is the "modified time"
	} catch (error) {
		return null;
	}
}

export function generatePythonClass(type: Type) {
	if (type.isInterface()) {
	} else if (type.isTypeParameter()) {
	}
}
