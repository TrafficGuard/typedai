import { expect } from 'chai';
import * as sinon from 'sinon';
import { logger } from '#o11y/logger';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { SearchReplaceCoder } from './searchReplaceCoder';
// Ensure _stripFilename is imported if _findFilenameFromPrecedingLines directly uses it from utils
import { _stripFilename } from './searchReplaceUtils';

describe.only('SearchReplaceCoder integration tests', () => {
    setupConditionalLoggerOutput();

    describe('_findFilename', () => {
        let coder: SearchReplaceCoder;
        beforeEach(() => {
            coder = new SearchReplaceCoder('.');
        });
    })
});