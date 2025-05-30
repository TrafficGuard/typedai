import * as path from 'node:path';
import { Project } from 'ts-morph';
import { funcClass } from '#functionSchema/functionDecorators';

export type TypeScriptIdentifierType = 'class' | 'interface' | 'enum';

@funcClass(__filename)
export class TypescriptRefactor {
	/**
	 * Move/rename a file and have all the imports updated accordingly.
	 * @param oldFilePath
	 * @param newFilePath
	 * @param projectRoot
	 */
	moveFile(oldFilePath: string, newFilePath: string, projectRoot = ''): void {
		// Initialize project
		const project = new Project({
			tsConfigFilePath: path.join(projectRoot, 'tsconfig.json'),
		});

		// Get the source file
		const sourceFile = project.getSourceFile(oldFilePath);
		if (!sourceFile) {
			console.error(`File not found: ${oldFilePath}`);
			return;
		}

		// Move the file (this updates imports automatically)
		sourceFile.move(newFilePath);

		// Save all changes
		project.saveSync();

		console.log(`Successfully moved ${oldFilePath} to ${newFilePath} and updated all imports.`);
	}

	/**
	 * Perform a refactoring rename, which updates all references to the identifier.
	 * @param filePath The file containing the identifier to rename.
	 * @param identifierType The type of identifier. Must be one of class, interface or enum.
	 * @param existingName
	 * @param newName
	 */
	async renameType(filePath: string, identifierType: TypeScriptIdentifierType, existingName: string, newName: string): Promise<void> {}
}
