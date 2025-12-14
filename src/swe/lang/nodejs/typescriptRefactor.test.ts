import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { expect } from 'chai';
import mock from 'mock-fs';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { TypescriptRefactor } from './typescriptRefactor';

describe('TypeScriptRefactor', () => {
	setupConditionalLoggerOutput();

	// Use resolve to ensure absolute paths for mock-fs keys
	const repoRoot = resolve('/mock-repo');

	let refactor: TypescriptRefactor;

	beforeEach(() => {
		// mock-fs is configured per test for renameType scenarios
		refactor = new TypescriptRefactor();
	});

	afterEach(() => {
		mock.restore();
	});

	describe('renameType', () => {
		it('should rename a class and update its references', () => {
			const fileADefinitionPath = 'fileA.ts';
			const fileBUsagePath = 'fileB.ts';
			const oldClassName = 'OldClassName';
			const newClassName = 'NewClassName';

			mock({
				[join(repoRoot, 'tsconfig.json')]: JSON.stringify({
					files: [fileADefinitionPath, fileBUsagePath],
				}),
				[join(repoRoot, fileADefinitionPath)]: `export class ${oldClassName} { constructor() { console.log('original'); } }`,
				[join(repoRoot, fileBUsagePath)]:
					`import { ${oldClassName} } from './${fileADefinitionPath.replace('.ts', '')}';\nconst instance = new ${oldClassName}();`,
			});

			refactor.renameType(join(repoRoot, fileADefinitionPath), 'class', oldClassName, newClassName, repoRoot);

			const fileAContent = fs.readFileSync(join(repoRoot, fileADefinitionPath), 'utf-8');
			const fileBContent = fs.readFileSync(join(repoRoot, fileBUsagePath), 'utf-8');

			expect(fileAContent).to.include(`export class ${newClassName}`);
			expect(fileAContent).to.not.include(`export class ${oldClassName}`);

			expect(fileBContent).to.include(`import { ${newClassName} } from './${fileADefinitionPath.replace('.ts', '')}'`);
			expect(fileBContent).to.include(`new ${newClassName}()`);
			expect(fileBContent).to.not.include(oldClassName);
		});

		it('should rename an interface and update its references', () => {
			const interfaceDefPath = 'interfaceDef.ts';
			const interfaceUserPath = 'interfaceUser.ts';
			const oldInterfaceName = 'OldInterfaceName';
			const newInterfaceName = 'NewInterfaceName';

			mock({
				[join(repoRoot, 'tsconfig.json')]: JSON.stringify({
					files: [interfaceDefPath, interfaceUserPath],
				}),
				[join(repoRoot, interfaceDefPath)]: `export interface ${oldInterfaceName} { prop: string; }`,
				[join(repoRoot, interfaceUserPath)]:
					`import { ${oldInterfaceName} } from './${interfaceDefPath.replace('.ts', '')}';\nconst obj: ${oldInterfaceName} = { prop: "test" };`,
			});

			refactor.renameType(join(repoRoot, interfaceDefPath), 'interface', oldInterfaceName, newInterfaceName, repoRoot);

			const defFileContent = fs.readFileSync(join(repoRoot, interfaceDefPath), 'utf-8');
			const userFileContent = fs.readFileSync(join(repoRoot, interfaceUserPath), 'utf-8');

			expect(defFileContent).to.include(`export interface ${newInterfaceName}`);
			expect(defFileContent).to.not.include(oldInterfaceName);

			expect(userFileContent).to.include(`import { ${newInterfaceName} } from './${interfaceDefPath.replace('.ts', '')}'`);
			expect(userFileContent).to.include(`const obj: ${newInterfaceName}`);
			expect(userFileContent).to.not.include(oldInterfaceName);
		});

		it('should rename an enum and update its references', () => {
			const enumDefPath = 'enumDef.ts';
			const enumUserPath = 'enumUser.ts';
			const oldEnumName = 'OldEnumName';
			const newEnumName = 'NewEnumName';

			mock({
				[join(repoRoot, 'tsconfig.json')]: JSON.stringify({
					files: [enumDefPath, enumUserPath],
				}),
				[join(repoRoot, enumDefPath)]: `export enum ${oldEnumName} { Member1, Member2 }`,
				[join(repoRoot, enumUserPath)]: `import { ${oldEnumName} } from './${enumDefPath.replace('.ts', '')}';\nconst val = ${oldEnumName}.Member1;`,
			});

			refactor.renameType(join(repoRoot, enumDefPath), 'enum', oldEnumName, newEnumName, repoRoot);

			const defFileContent = fs.readFileSync(join(repoRoot, enumDefPath), 'utf-8');
			const userFileContent = fs.readFileSync(join(repoRoot, enumUserPath), 'utf-8');

			expect(defFileContent).to.include(`export enum ${newEnumName}`);
			expect(defFileContent).to.not.include(oldEnumName);

			expect(userFileContent).to.include(`import { ${newEnumName} } from './${enumDefPath.replace('.ts', '')}'`);
			expect(userFileContent).to.include(`const val = ${newEnumName}.Member1`);
			expect(userFileContent).to.not.include(oldEnumName);
		});

		it('should not modify file when trying to rename a non-existent identifier', () => {
			const filePath = 'fileA.ts';
			const existingName = 'NonExistentIdentifier';
			const newName = 'NewIdentifier';

			mock({
				[join(repoRoot, 'tsconfig.json')]: JSON.stringify({
					files: [filePath],
				}),
				[join(repoRoot, filePath)]: 'export class SomeClass {}',
			});

			refactor.renameType(join(repoRoot, filePath), 'class', existingName, newName, repoRoot);

			const fileContent = fs.readFileSync(join(repoRoot, filePath), 'utf-8');
			expect(fileContent).to.include('export class SomeClass {}'); // Content should be unchanged
		});

		it('should handle non-existent file gracefully', () => {
			const filePath = 'nonExistentFile.ts';
			const existingName = 'AnyIdentifier';
			const newName = 'NewIdentifier';

			mock({
				[join(repoRoot, 'tsconfig.json')]: JSON.stringify({
					files: [filePath],
				}),
				// No actual file created for nonExistentFile.ts
			});

			// Should not throw
			refactor.renameType(join(repoRoot, filePath), 'class', existingName, newName, repoRoot);
		});

		it('should not modify file for an unsupported identifier type', () => {
			const filePath = 'fileA.ts';
			const existingName = 'SomeName';
			const newName = 'NewName';
			const originalContent = `export function ${existingName}() {}`;

			mock({
				[join(repoRoot, 'tsconfig.json')]: JSON.stringify({
					files: [filePath],
				}),
				[join(repoRoot, filePath)]: originalContent, // A function, not class/interface/enum
			});

			// Cast to any to bypass TypeScript type checking for the test
			refactor.renameType(join(repoRoot, filePath), 'function' as any, existingName, newName, repoRoot);

			const fileContent = fs.readFileSync(join(repoRoot, filePath), 'utf-8');
			expect(fileContent).to.equal(originalContent); // Content should be unchanged
		});
	});

	describe('moveFile', () => {
		it('should move a file to a new name in the same directory and update imports', () => {
			mock({
				[join(repoRoot, 'tsconfig.json')]: JSON.stringify({
					files: ['src/fileToMove.ts', 'src/importer.ts'],
					compilerOptions: { rootDir: '.', outDir: 'dist' },
				}),
				[join(repoRoot, 'src/fileToMove.ts')]: 'export class MyClassToMove {}',
				[join(repoRoot, 'src/importer.ts')]: `import { MyClassToMove } from './fileToMove';\nconst instance = new MyClassToMove();`,
			});

			refactor.moveFile(join(repoRoot, 'src/fileToMove.ts'), join(repoRoot, 'src/fileHasBeenMoved.ts'), repoRoot);

			expect(fs.existsSync(join(repoRoot, 'src/fileToMove.ts'))).to.be.false;
			expect(fs.existsSync(join(repoRoot, 'src/fileHasBeenMoved.ts'))).to.be.true;
			const movedFileContent = fs.readFileSync(join(repoRoot, 'src/fileHasBeenMoved.ts'), 'utf-8');
			expect(movedFileContent).to.include('export class MyClassToMove {}');
			const importerFileContent = fs.readFileSync(join(repoRoot, 'src/importer.ts'), 'utf-8');
			expect(importerFileContent).to.include("import { MyClassToMove } from './fileHasBeenMoved';");
			expect(importerFileContent).to.include('const instance = new MyClassToMove();');
		});

		it('should move a file to a different directory and update imports', () => {
			mock({
				[join(repoRoot, 'tsconfig.json')]: JSON.stringify({
					files: ['src/fileToMoveToSubdir.ts', 'src/importerForSubdir.ts'],
					compilerOptions: { rootDir: '.', outDir: 'dist' },
				}),
				[join(repoRoot, 'src/fileToMoveToSubdir.ts')]: 'export class MyClassForSubdir {}',
				[join(repoRoot, 'src/importerForSubdir.ts')]: `import { MyClassForSubdir } from './fileToMoveToSubdir';\nconst instance = new MyClassForSubdir();`,
				[join(repoRoot, 'dest')]: {}, // Mock the destination directory
			});

			refactor.moveFile(join(repoRoot, 'src/fileToMoveToSubdir.ts'), join(repoRoot, 'dest/movedToDest.ts'), repoRoot);

			expect(fs.existsSync(join(repoRoot, 'src/fileToMoveToSubdir.ts'))).to.be.false;
			expect(fs.existsSync(join(repoRoot, 'dest/movedToDest.ts'))).to.be.true;
			const movedFileContent = fs.readFileSync(join(repoRoot, 'dest/movedToDest.ts'), 'utf-8');
			expect(movedFileContent).to.include('export class MyClassForSubdir {}');
			const importerFileContent = fs.readFileSync(join(repoRoot, 'src/importerForSubdir.ts'), 'utf-8');
			expect(importerFileContent).to.include("import { MyClassForSubdir } from '../dest/movedToDest';"); // Note relative path
			expect(importerFileContent).to.include('const instance = new MyClassForSubdir();');
		});

		it('should not create destination file when trying to move a non-existent file', () => {
			mock({
				[join(repoRoot, 'tsconfig.json')]: JSON.stringify({
					files: [], // No files relevant to the non-existent one
					compilerOptions: { rootDir: '.', outDir: 'dist' },
				}),
			});

			// Should not throw
			refactor.moveFile(join(repoRoot, 'nonExistentSourceFile.ts'), join(repoRoot, 'anywhere.ts'), repoRoot);

			expect(fs.existsSync(join(repoRoot, 'anywhere.ts'))).to.be.false;
		});
	});

	describe.skip('Integration Test - Cross-Project Refactoring', () => {
		const integrationRepoRoot = resolve('/mock-repo-integration');

		it('should rename a shared interface and update references in backend (src) and frontend (frontend/src) files', () => {
			const tsConfigContent = {
				compilerOptions: {
					module: 'commonjs',
					esModuleInterop: true,
					target: 'es6',
					moduleResolution: 'node',
					sourceMap: true,
					outDir: 'dist',
					baseUrl: '.',
					paths: { '*': ['node_modules/*'] },
				},
				include: ['src/**/*.ts', 'shared/**/*.ts', 'frontend/src/**/*.ts'],
			};

			mock({
				[integrationRepoRoot]: {
					// Create the root directory
					'tsconfig.json': JSON.stringify(tsConfigContent),
					shared: {
						'commonType.ts': 'export interface MySharedInterface { id: string; value: string; }',
					},
					src: {
						'backendService.ts':
							"import { MySharedInterface } from '../shared/commonType';\nexport class BackendService { process(item: MySharedInterface): string { return `Processed ${item.id}`; } }",
					},
					frontend: {
						src: {
							'uiComponent.ts':
								"import { MySharedInterface } from '../../shared/commonType';\nexport class UiComponent { render(data: MySharedInterface): string { return `Displaying ${data.value}`; } }",
						},
					},
				},
			});

			const sharedTypePath = join(integrationRepoRoot, 'shared/commonType.ts');
			refactor.renameType(sharedTypePath, 'interface', 'MySharedInterface', 'MyGlobalStandardInterface', integrationRepoRoot);

			const sharedContent = fs.readFileSync(join(integrationRepoRoot, 'shared/commonType.ts'), 'utf-8');
			const backendContent = fs.readFileSync(join(integrationRepoRoot, 'src/backendService.ts'), 'utf-8');
			const frontendContent = fs.readFileSync(join(integrationRepoRoot, 'frontend/src/uiComponent.ts'), 'utf-8');

			expect(sharedContent).to.include('export interface MyGlobalStandardInterface');
			expect(sharedContent).to.not.include('MySharedInterface');

			expect(backendContent).to.include("import { MyGlobalStandardInterface } from '../shared/commonType'");
			expect(backendContent).to.include('item: MyGlobalStandardInterface');
			expect(backendContent).to.not.include('MySharedInterface');

			expect(frontendContent).to.include("import { MyGlobalStandardInterface } from '../../shared/commonType'");
			expect(frontendContent).to.include('data: MyGlobalStandardInterface');
			expect(frontendContent).to.not.include('MySharedInterface');
		});
	});
});
