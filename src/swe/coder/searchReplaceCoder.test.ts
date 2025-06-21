import { expect } from 'chai';
import mockFs from 'mock-fs';
import * as sinon from 'sinon';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { LLM } from '#shared/llm/llm.model';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import { Git } from '#src/functions/scm/git';
import { CoderExhaustedAttemptsError } from '../sweErrors';
import { EditApplier } from './editApplier';
import { SearchReplaceCoder } from './searchReplaceCoder';

describe('SearchReplaceCoder: Reflection Logic', () => {
	let coder: SearchReplaceCoder;
	let mockLlms: sinon.SinonStubbedInstance<AgentLLMs>;
	let mockMediumLlm: sinon.SinonStubbedInstance<LLM>;
	let fs: IFileSystemService;
	let mockVcs: sinon.SinonStubbedInstance<VersionControlSystem>;
	let loggerWarnSpy: sinon.SinonSpy;

	const SEARCH_BLOCK_VALID = `test.ts
\`\`\`typescript
<<<<<<< SEARCH
hello world
