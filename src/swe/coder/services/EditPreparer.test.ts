import { expect } from 'chai';
import * as sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { EditPreparer } from './EditPreparer';

describe('EditPreparer', () => {
	setupConditionalLoggerOutput();

	afterEach(() => {
		sinon.restore();
	});

	// Tests will be added here
});
