import path from 'node:path';
import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';
import ignore, { type Ignore } from 'ignore';
import mock from 'mock-fs';
import sinon from 'sinon';
import { FileSystemService } from '#functions/storage/fileSystemService';
import * as tokens from '#llm/tokens';
import { File, Folder, buildFolderStructure } from './repositoryMap';
import {buildIndexDocs} from "#swe/index/repoIndexDocBuilder";

// Enable chai-subset
chai.use(chaiSubset);

describe.skip('buildIndexDocs', () => {
        let fileSystemService: FileSystemService;
        let countTokensStub: sinon.SinonStub;

        // Define the mock file system structure
        const mockFileSystemStructure = {
            '/mock-repo': {}
        }
    }
)
