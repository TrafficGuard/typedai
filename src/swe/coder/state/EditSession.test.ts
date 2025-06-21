import { setupConditionalLoggerOutput } from '#test/testUtils';
import { expect } from 'chai';
import type { ApplicationResult, EditBlock } from './EditSession';
import { EditSession } from './EditSession';

describe('EditSession', () => {
	setupConditionalLoggerOutput();

	let session: EditSession;
	const workingDir = '/test/dir';
	const requirements = 'test requirements';

	beforeEach(() => {
		session = new EditSession(workingDir, requirements);
	});

	describe('constructor and initial state', () => {
		it('should initialize with attempt 0 and empty collections', () => {
			expect(session.attempt).to.equal(0);
			expect(session.appliedFiles.size).to.equal(0);
			expect(session.failedEdits).to.be.empty;
			expect(session.reflections).to.be.empty;
			expect(session.lastReflection).to.be.undefined;
		});

		it('should correctly store workingDir and requirements', () => {
			expect(session.workingDir).to.equal(workingDir);
			expect(session.requirements).to.equal(requirements);
		});
	});

	describe('#incrementAttempt', () => {
		it('should increment the attempt counter', () => {
			session.incrementAttempt();
			expect(session.attempt).to.equal(1);
			session.incrementAttempt();
			expect(session.attempt).to.equal(2);
		});

		it('should reset the promptBuilt flag to false', () => {
			session.markPromptBuilt();
			expect(session.shouldRebuildPrompt()).to.be.false;
			session.incrementAttempt();
			expect(session.shouldRebuildPrompt()).to.be.true;
		});
	});

	describe('#recordApplication', () => {
		it('should add applied files to the appliedFiles set', () => {
			const result: ApplicationResult = {
				applied: ['file1.ts', 'file2.ts'],
				failed: [],
			};
			session.recordApplication(result);
			expect(Array.from(session.appliedFiles)).to.deep.equal(['file1.ts', 'file2.ts']);
		});

		it('should overwrite failedEdits with the new list', () => {
			const failedEdit: EditBlock = { filePath: 'fail.ts', originalText: 'a', updatedText: 'b' };
			const result: ApplicationResult = {
				applied: [],
				failed: [failedEdit],
			};
			session.recordApplication(result);
			expect(session.failedEdits).to.deep.equal([failedEdit]);

			const newResult: ApplicationResult = { applied: [], failed: [] };
			session.recordApplication(newResult);
			expect(session.failedEdits).to.be.empty;
		});

		it('should not add duplicate file paths to appliedFiles', () => {
			const result1: ApplicationResult = { applied: ['file1.ts'], failed: [] };
			session.recordApplication(result1);
			const result2: ApplicationResult = { applied: ['file1.ts', 'file2.ts'], failed: [] };
			session.recordApplication(result2);
			expect(session.appliedFiles.size).to.equal(2);
			expect(Array.from(session.appliedFiles)).to.have.members(['file1.ts', 'file2.ts']);
		});
	});

	describe('#addReflection', () => {
		it('should add a new reflection to the history', () => {
			session.addReflection('reflection 1');
			expect(session.reflections).to.deep.equal(['reflection 1']);
			session.addReflection('reflection 2');
			expect(session.reflections).to.deep.equal(['reflection 1', 'reflection 2']);
		});

		it('should update lastReflection to the most recent one', () => {
			expect(session.lastReflection).to.be.undefined;
			session.addReflection('reflection 1');
			expect(session.lastReflection).to.equal('reflection 1');
			session.addReflection('reflection 2');
			expect(session.lastReflection).to.equal('reflection 2');
		});
	});

	describe('#isComplete', () => {
		it('should return true when there are no failed edits and files have been applied', () => {
			const result: ApplicationResult = { applied: ['file1.ts'], failed: [] };
			session.recordApplication(result);
			expect(session.isComplete()).to.be.true;
		});

		it('should return false if there are failed edits', () => {
			const result: ApplicationResult = {
				applied: ['file1.ts'],
				failed: [{ filePath: 'fail.ts', originalText: 'a', updatedText: 'b' }],
			};
			session.recordApplication(result);
			expect(session.isComplete()).to.be.false;
		});

		it('should return false if no files have been applied', () => {
			const result: ApplicationResult = { applied: [], failed: [] };
			session.recordApplication(result);
			expect(session.isComplete()).to.be.false;
		});

		it('should return false on initial state', () => {
			expect(session.isComplete()).to.be.false;
		});
	});

	describe('prompt building flags', () => {
		it('shouldRebuildPrompt should be true initially', () => {
			expect(session.shouldRebuildPrompt()).to.be.true;
		});

		it('markPromptBuilt should make shouldRebuildPrompt return false', () => {
			session.markPromptBuilt();
			expect(session.shouldRebuildPrompt()).to.be.false;
		});
	});

	describe('state immutability', () => {
		it('should not allow modification of the internal failedEdits array via its getter', () => {
			const result: ApplicationResult = {
				applied: [],
				failed: [{ filePath: 'a', originalText: 'b', updatedText: 'c' }],
			};
			session.recordApplication(result);

			const failedEdits = session.failedEdits as EditBlock[];
			failedEdits.push({ filePath: 'd', originalText: 'e', updatedText: 'f' });

			expect(session.failedEdits.length).to.equal(1);
		});

		it('should not allow modification of the internal reflections array via its getter', () => {
			session.addReflection('reflection 1');
			const reflections = session.reflections as string[];
			reflections.push('new reflection');
			expect(session.reflections.length).to.equal(1);
		});

		it('should not allow modification of the internal appliedFiles set via its getter', () => {
			session.recordApplication({ applied: ['file1.ts'], failed: [] });
			const appliedFiles = session.appliedFiles as Set<string>;
			appliedFiles.add('new file');
			expect(session.appliedFiles.has('new file')).to.be.false;
			expect(session.appliedFiles.size).to.equal(1);
		});
	});
});
