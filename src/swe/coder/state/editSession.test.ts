import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock } from '../coderTypes';
import type { EditApplicationResult } from './editSession';
import { EditSession } from './editSession';

describe('EditSession', () => {
	setupConditionalLoggerOutput();

	const MOCK_WORKING_DIR = '/path/to/project';
	const MOCK_REQUIREMENTS = 'Implement the feature.';

	describe('constructor and initial state', () => {
		it('should initialize with attempt 0 and empty collections', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);

			expect(session.attempt).to.equal(0);
			expect(session.appliedFiles.size).to.equal(0);
			expect(session.failedEdits).to.be.an('array').that.is.empty;
			expect(session.reflections).to.be.an('array').that.is.empty;
			expect(session.lastReflection).to.be.undefined;
			// Verify new state properties are initialized
			expect(session.absFnamesInChat.size).to.equal(0);
			expect(session.initiallyDirtyFiles.size).to.equal(0);
			expect(session.fileContentSnapshots.size).to.equal(0);
		});

		it('should correctly store workingDir and requirements', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);

			expect(session.workingDir).to.equal(MOCK_WORKING_DIR);
			expect(session.requirements).to.equal(MOCK_REQUIREMENTS);
		});
	});

	describe('#incrementAttempt', () => {
		it('should increment the attempt counter', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			expect(session.attempt).to.equal(0);

			session.incrementAttempt();
			expect(session.attempt).to.equal(1);

			session.incrementAttempt();
			expect(session.attempt).to.equal(2);
		});
	});

	describe('Prompt Stale Management', () => {
		it('should manage the prompt stale state correctly', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);

			// Initially, prompt should be stale
			expect(session.isPromptStale()).to.be.true;

			// Mark as built
			session.markPromptBuilt();
			expect(session.isPromptStale()).to.be.false;

			// Incrementing attempt should not change the flag
			session.incrementAttempt();
			expect(session.isPromptStale()).to.be.false;

			// Mark as stale again
			session.markPromptStale();
			expect(session.isPromptStale()).to.be.true;
		});
	});

	describe('#recordApplication', () => {
		const failedEdit: EditBlock = { filePath: 'src/b.ts', originalText: 'b', updatedText: 'B' };

		it('should add applied files to the appliedFiles set', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const result: EditApplicationResult = {
				applied: ['src/a.ts'],
				failed: [],
			};

			session.recordEditApplication(result);

			expect(Array.from(session.appliedFiles)).to.deep.equal(['src/a.ts']);
		});

		it('should overwrite failedEdits with the new list', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);

			// First attempt
			const result1: EditApplicationResult = { applied: [], failed: [failedEdit] };
			session.recordEditApplication(result1);
			expect(session.failedEdits).to.deep.equal([failedEdit]);

			// Second attempt (e.g., after a fix)
			const newFailedEdit: EditBlock = { filePath: 'src/c.ts', originalText: 'c', updatedText: 'C' };
			const result2: EditApplicationResult = { applied: ['src/b.ts'], failed: [newFailedEdit] };
			session.recordEditApplication(result2);

			expect(session.failedEdits).to.deep.equal([newFailedEdit]);
		});

		it('should not add duplicate file paths to appliedFiles', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);

			session.recordEditApplication({ applied: ['src/a.ts', 'src/b.ts'], failed: [] });
			session.recordEditApplication({ applied: ['src/b.ts', 'src/c.ts'], failed: [] });

			expect(session.appliedFiles.size).to.equal(3);
			expect(Array.from(session.appliedFiles)).to.have.members(['src/a.ts', 'src/b.ts', 'src/c.ts']);
		});
	});

	describe('#addReflection', () => {
		it('should add a new reflection to the history', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const reflection1 = 'I should try a different approach.';
			const reflection2 = 'The second approach worked better.';

			session.addReflection(reflection1);
			expect(session.reflections).to.deep.equal([reflection1]);

			session.addReflection(reflection2);
			expect(session.reflections).to.deep.equal([reflection1, reflection2]);
		});

		it('should update lastReflection to the most recent one', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const reflection1 = 'First reflection.';
			const reflection2 = 'Second reflection.';

			session.addReflection(reflection1);
			expect(session.lastReflection).to.equal(reflection1);

			session.addReflection(reflection2);
			expect(session.lastReflection).to.equal(reflection2);
		});
	});

	describe('#isComplete', () => {
		it('should return false on initial state', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			expect(session.isComplete()).to.be.false;
		});

		it('should return false if there are failed edits', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const result: EditApplicationResult = {
				applied: ['src/a.ts'],
				failed: [{ filePath: 'src/b.ts', originalText: 'b', updatedText: 'B' }],
			};
			session.recordEditApplication(result);
			expect(session.isComplete()).to.be.false;
		});

		it('should return false if no files have been applied', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const result: EditApplicationResult = {
				applied: [],
				failed: [],
			};
			session.recordEditApplication(result);
			expect(session.isComplete()).to.be.false;
		});

		it('should return true when there are no failed edits and at least one file has been applied', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const result: EditApplicationResult = {
				applied: ['src/a.ts'],
				failed: [],
			};
			session.recordEditApplication(result);
			expect(session.isComplete()).to.be.true;
		});
	});

	describe('state immutability', () => {
		it('should not allow modification of the failedEdits array via its getter', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const failedEdit: EditBlock = { filePath: 'src/b.ts', originalText: 'b', updatedText: 'B' };
			session.recordEditApplication({ applied: [], failed: [failedEdit] });

			// Attempt to mutate the retrieved array by casting away readonly
			const failed = session.failedEdits as EditBlock[];
			failed.push({ filePath: 'injected.ts', originalText: 'bad', updatedText: 'actor' });

			// The original state should remain unchanged
			expect(session.failedEdits).to.have.lengthOf(1);
			expect(session.failedEdits[0]).to.deep.equal(failedEdit);
		});

		it('should not allow modification of the reflections array via its getter', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			session.addReflection('First thought');

			// Attempt to mutate the retrieved array
			const reflections = session.reflections as string[];
			reflections.push('Second thought');

			// The original state should remain unchanged
			expect(session.reflections).to.have.lengthOf(1);
			expect(session.reflections[0]).to.equal('First thought');
		});

		it('should not allow modification of the appliedFiles set via its getter', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			session.recordEditApplication({ applied: ['file.ts'], failed: [] });

			// Attempt to mutate the retrieved set by casting away ReadonlySet
			const applied = session.appliedFiles as Set<string>;

			// This should throw an error if the underlying object is frozen,
			// or simply not affect the original if it's a copy.
			// We test that the original is unaffected.
			applied.add('another.ts');

			// The original state should remain unchanged
			expect(session.appliedFiles.size).to.equal(1);
			expect(session.appliedFiles.has('another.ts')).to.be.false;
		});
	});

	describe('File Context Management', () => {
		it('should initialize file context correctly', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const fnames = new Set(['/path/to/project/file1.ts']);
			const dirty = new Set(['file1.ts']);

			session.initializeFileContext(fnames, dirty);

			expect(session.absFnamesInChat).to.deep.equal(fnames);
			expect(session.initiallyDirtyFiles).to.deep.equal(dirty);
		});

		it('should add a file to the chat context', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const filePath = '/path/to/project/file.ts';
			session.addFileToChat(filePath);
			expect(session.absFnamesInChat.has(filePath)).to.be.true;
		});

		it('should set and retrieve a file snapshot', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const relPath = 'src/app.ts';
			const content = 'console.log("hello");';

			session.setFileSnapshot(relPath, content);

			expect(session.fileContentSnapshots.get(relPath)).to.equal(content);
		});

		it('should handle null snapshots for unreadable files', () => {
			const session = new EditSession(MOCK_WORKING_DIR, MOCK_REQUIREMENTS, false, false);
			const relPath = 'src/unreadable.ts';

			session.setFileSnapshot(relPath, null);

			expect(session.fileContentSnapshots.get(relPath)).to.be.null;
		});
	});
});
