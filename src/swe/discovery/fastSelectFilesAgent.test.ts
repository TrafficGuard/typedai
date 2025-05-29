import { expect } from 'chai';
import mock from 'mock-fs';
import sinon from 'sinon';
import * as agentContextLocalStorageModule from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/files/files.model';
import type { UserContentExt } from '#shared/llm/llm.model';
import type { ProjectInfo } from '#swe/projectDetection';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { fastSelectFilesAgent } from './fastSelectFilesAgent';

describe('selectFilesAndExtracts', () => {
    setupConditionalLoggerOutput();

    let queryWithFileSelection2Stub: sinon.SinonStub;
    let generateTextWithJsonStub: sinon.SinonStub;
    let readFileStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
    let loggerWarnStub: sinon.SinonStub;
    let loggerInfoStub: sinon.SinonStub;

    const mockRequirementsString: UserContentExt = 'Test requirements as string';
    const mockRequirementsObject: UserContentExt = [{type: 'text', text: 'Test requirements as object'}];
    const mockProjectInfo: ProjectInfo | undefined = undefined; // Keep it simple, can be expanded if needed

    beforeEach(() => {
    });
})
