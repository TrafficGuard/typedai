import path from 'node:path';
import { expect } from 'chai';
import mock from 'mock-fs';
import sinon from 'sinon';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { TypescriptTools } from './lang/nodejs/typescriptTools';
import { AI_INFO_FILENAME, type ProjectInfoFileFormat, detectProjectInfo } from './projectDetection';
import { supportingInformation } from './supportingInformation';

describe('supportingInformation', () => {
	setupConditionalLoggerOutput();

	const repoRoot = path.resolve('/repo');
	const frontendDir = path.join(repoRoot, 'frontend');

	const projectInfoData: ProjectInfoFileFormat[] = [
		{
			baseDir: './',
			language: 'typescript',
			primary: true,
			devBranch: 'main',
			initialise: '',
			compile: '',
			format: '',
			staticAnalysis: '',
			test: '',
			indexDocs: [],
		},
		{
			baseDir: 'frontend',
			language: 'typescript',
			devBranch: 'main',
			initialise: '',
			compile: '',
			format: '',
			staticAnalysis: '',
			test: '',
			indexDocs: [],
		},
	];

	const typedAiJson = JSON.stringify(projectInfoData, null, 2);

	const fsStructure = {
		[repoRoot]: {
			'package.json': JSON.stringify({ dependencies: { express: '1.0.0' } }),
			'.git': { HEAD: 'ref: refs/heads/main', config: '' },
			'.gitignore': '',
			src: { 'index.ts': '' },
			[AI_INFO_FILENAME]: typedAiJson,
			frontend: {
				'package.json': JSON.stringify({ dependencies: { '@angular/core': '19.0.0' } }),
				src: { 'app.component.ts': '' },
			},
		},
	};

	// Stub getInstalledPackages so we don’t depend on real implementation
	beforeEach(() => {
		mock(fsStructure, { createCwd: false });
		sinon.stub(TypescriptTools.prototype, 'getInstalledPackages').callsFake(async () => {
			const wd = getFileSystem().getWorkingDirectory();
			return wd.includes('frontend') ? '<installed_packages>FRONTEND</installed_packages>' : '<installed_packages>BACKEND</installed_packages>';
		});

		// Stub getVcsRoot to prevent Git calls and agent context issues in tests
		sinon.stub(FileSystemService.prototype, 'getVcsRoot').returns(null);

		getFileSystem().setWorkingDirectory(repoRoot);
	});

	afterEach(() => {
		sinon.restore();
		mock.restore();
	});

	it('returns backend packages for backend-only selection', async () => {
		const backendProject = (await detectProjectInfo()).find((p) => p.baseDir === './')!;
		const result = await supportingInformation(backendProject, ['src/index.ts']);

		expect(result).to.contain('BACKEND');
		expect(result).to.not.contain('FRONTEND');
	});

	it('returns frontend packages for frontend-only selection', async () => {
		const backendProject = (await detectProjectInfo()).find((p) => p.baseDir === './')!;
		const result = await supportingInformation(backendProject, ['frontend/src/app.component.ts']);

		expect(result).to.contain('FRONTEND');
		expect(result).to.not.contain('BACKEND');
	});

	it('returns both package blocks when files from both projects are selected', async () => {
		const backendProject = (await detectProjectInfo()).find((p) => p.baseDir === './')!;
		const result = await supportingInformation(backendProject, ['src/index.ts', 'frontend/src/app.component.ts']);

		expect(result).to.contain('BACKEND');
		expect(result).to.contain('FRONTEND');
	});

	it('detects correct packages when CWD is inside frontend', async () => {
		getFileSystem().setWorkingDirectory(frontendDir);

		const backendProject = (await detectProjectInfo()).find((p) => p.baseDir === './')!;
		const result = await supportingInformation(backendProject, ['src/app.component.ts']);

		expect(result).to.contain('FRONTEND');
		expect(result).to.not.contain('BACKEND');
	});
});
