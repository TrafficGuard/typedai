import { expect } from 'chai';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { system, user } from '#shared/llm/llm.model';
import { gpt5_1_codex, isCodexCliAvailable } from './codex';

describe('CodexExec Integration', function () {
	this.timeout(120000);

	before(async function () {
		if (!isCodexCliAvailable()) this.skip();
		initInMemoryApplicationContext();
	});

	it('should generate a response using the Codex CLI', async () => {
		const llm = gpt5_1_codex();
		const result = await llm.generateMessage(
			[system('You are a precise assistant. Respond with short answers.'), user('What is 2 + 2? Answer using only the number.')],
			{ id: 'codex-cli-basic-test' },
		);

		expect(result).to.exist;
		expect(result.role).to.equal('assistant');
		expect(result.content).to.be.a('string');
		expect((result.content as string).trim()).to.match(/4/);
		expect(result.stats).to.exist;
		expect(result.stats?.totalTime).to.be.greaterThan(0);
	});
});
