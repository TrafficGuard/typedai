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
	 * @param projectRoot
	 */
	renameType(filePath: string, identifierType: TypeScriptIdentifierType, existingName: string, newName: string, projectRoot = ''): void {
		const project = new Project({
			tsConfigFilePath: path.join(projectRoot, 'tsconfig.json'),
			// Note: For rename operations to update references across the entire project,
			// ts-morph needs to be aware of all relevant files. The tsConfigFilePath
			// is the primary way it discovers these files. Ensure the tsconfig.json
			// (either real or mock for tests) correctly includes all paths
			// where references might need updating.
		});

		const sourceFile = project.getSourceFile(filePath);
		if (!sourceFile) {
			console.error(`File not found: ${filePath}`);
			return;
		}

		// It's good practice to type the node if possible, or ensure it has the 'rename' method.
		// ts-morph's ClassDeclaration, InterfaceDeclaration, EnumDeclaration, etc., all have .rename().
		let identifierNode;

		switch (identifierType) {
			case 'class':
				identifierNode = sourceFile.getClass(existingName);
				break;
			case 'interface':
				identifierNode = sourceFile.getInterface(existingName);
				break;
			case 'enum':
				identifierNode = sourceFile.getEnum(existingName);
				break;
			default:
				// It's good to log an error or throw if the type is unsupported.
				console.error(`Unsupported identifier type: ${identifierType}. Must be 'class', 'interface', or 'enum'.`);
				return; // Exit if type is invalid
		}

		if (!identifierNode) {
			console.error(`Identifier "${existingName}" of type "${identifierType}" not found in file "${filePath}".`);
			return; // Exit if identifier is not found
		}

		// The .rename() method on these declaration nodes handles updating all references
		// throughout the project (all files known to the ts-morph Project instance).
		// Default options for rename are: renameInStrings: false, renameInComments: false.
		// These can be passed as an options object if needed: e.g., identifierNode.rename(newName, { renameInStrings: true });
		identifierNode.rename(newName);

		// project.save() or project.saveSync() saves all modified files in the project.
		try {
			project.saveSync();
			console.log(`Successfully renamed ${identifierType} "${existingName}" to "${newName}" in ${filePath} and updated all references across the project.`);
		} catch (e: any) { // Catching 'any' for error object is common in TS for unknown error structures
			console.error(`Error saving changes after rename: ${e.message}`);
			// Optionally, re-throw or handle more gracefully depending on desired error management.
		}
	}
}
