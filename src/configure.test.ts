import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'chai';

const projectRoot = path.resolve(__dirname, '..');

const interactiveLogging = true;

/**
 * Executes the `bin/configure_test` script in a Docker container.
 * This simulates a run on a clean system.
 * @param envVars Environment variables to pass to the configure script inside the container.
 * @returns A promise that resolves with the stdout, stderr, and exit code.
 */
async function runConfigure(envVars: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
	const scriptPath = path.join(projectRoot, 'bin', 'configure_test');

	return new Promise((resolve, reject) => {
		const proc = spawn(scriptPath, [], {
			cwd: projectRoot,
			env: {
				...process.env,
				...envVars,
			},
			shell: true, // Important for executing a shell script directly
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', (data) => {
			const output = data.toString();
			if (interactiveLogging) console.log(output);
			stdout += output;
			// For debugging test runs in real-time:
			// process.stdout.write(output);
		});

		proc.stderr?.on('data', (data) => {
			const output = data.toString();
			if (interactiveLogging) console.error(output);
			stderr += output;
			// For debugging test runs in real-time:
			// process.stderr.write(output);
		});

		proc.on('close', (exitCode) => {
			resolve({ stdout, stderr, exitCode });
		});

		proc.on('error', (err) => {
			reject(err);
		});
	});
}

describe.skip('bin/configure script end-to-end tests', () => {
	describe('Initial Setup (Prerequisites)', () => {
		// Set a long timeout for this test as it involves Docker builds and package installations.
		const TEST_TIMEOUT = 5 * 60 * 1000; // 5 minutes

		it('should successfully run the full prerequisite installation on a clean Linux system', async function () {
			this.timeout(TEST_TIMEOUT);

			const envVars = {
				// Automate all prompts to run non-interactively
				TYPEDAI_TEST_USE_GCP: 'n', // Skip GCP for this basic test
				TYPEDAI_TEST_DB_TYPE: 'inmemory', // Choose the simplest DB
				TYPEDAI_TEST_PYENV_INSTALL_CHOICE: '1', // Install pyenv via script
				TYPEDAI_TEST_FNM_INSTALL_CHOICE: '1', // Install fnm via script
				TYPEDAI_TEST_SINGLE_USER_EMAIL: 'test@example.com',
				// On the ubuntu:latest image, apt-get is available. The Dockerfile does not install brew.
				// The ripgrep_setup script will therefore default to offering apt-get, which is choice '1'.
				TYPEDAI_TEST_RG_INSTALL_CHOICE: '1',
			};

			const result = await runConfigure(envVars);

			if (!interactiveLogging) {
				console.log(result.stdout);
				console.log(result.stderr);
			}

			// Primary assertion: the script must exit successfully.
			// The error message includes stdout/stderr for easier debugging on failure.
			expect(result.exitCode, `Configure script failed. Stderr:\n${result.stderr}\nStdout:\n${result.stdout}`).to.equal(0);

			// Check for key success messages in stdout to ensure major stages completed.
			expect(result.stdout).to.include('Python environment setup complete.');
			expect(result.stdout).to.include('Node.js environment setup complete.');
			expect(result.stdout).to.include('Ripgrep setup complete.');
			expect(result.stdout).to.include('✅ Configuration complete.');

			// Check that the script attempted to install the correct tool versions.
			const pythonVersion = fs.readFileSync(path.join(projectRoot, '.python-version'), 'utf-8').trim();
			const nodeVersion = fs.readFileSync(path.join(projectRoot, '.node-version'), 'utf-8').trim();
			expect(result.stdout).to.include(`Desired Python version read from .python-version: ${pythonVersion}`);
			expect(result.stdout).to.include(`Desired Node.js version read from .node-version: ${nodeVersion}`);

			// Check that the installation logic for each tool was triggered as expected.
			expect(result.stdout).to.include('Running pyenv installation script');
			expect(result.stdout).to.include('Running fnm installation script');
			expect(result.stdout).to.include('On Debian/Ubuntu-based systems, the recommended installation method is apt-get.');
			expect(result.stdout).to.include('Running: sudo apt-get update -y && sudo apt-get install -y ripgrep');
		});

		it('should successfully install Python via pyenv on a clean macOS system');
		it('should use an existing pyenv installation if available');
		it('should successfully install the Python version specified in .python-version');
		it('should upgrade pip successfully');

		it('should successfully install Node.js via fnm on a clean Linux system');
		it('should successfully install Node.js via fnm on a clean macOS system');
		it('should use an existing fnm installation if available');
		it('should successfully install the Node.js version specified in .node-version');
		it('should run "npm install" in the root directory successfully');

		it('should successfully install ripgrep via brew on macOS');
		it('should successfully install ripgrep via apt-get on Linux');
		it('should successfully install ripgrep via brew on Linux if available');
		it('should use an existing ripgrep installation if available');
	});

	describe('Environment File Handling', () => {
		it('should create local.env from example if it does not exist');
		it('should create test.env from example if it does not exist');
		it('should not overwrite an existing local.env file');
		it('should not overwrite an existing test.env file');
	});

	describe('GCP Configuration Flow', () => {
		it('should skip GCP setup if user selects "n"');
		it('should run GCP setup if user selects "y"');
		it('should correctly set GCLOUD_PROJECT and GCLOUD_REGION in local.env when prompted');
		it('should set TRACE_AGENT_ENABLED=true in local.env on successful GCP setup');
		it('should set TRACE_AGENT_ENABLED=false in local.env on skipped GCP setup');
		it('should set TRACE_AGENT_ENABLED=false in local.env on failed GCP setup');
	});

	describe('Database Selection and Setup', () => {
		describe('In-Memory Database', () => {
			it('should set DATABASE_TYPE=memory in local.env');
			it('should not run any further database-specific setup scripts');
		});

		describe('PostgreSQL Database', () => {
			it('should set DATABASE_TYPE=postgres in local.env');
			it('should run the postgres_setup script');
			it('should attempt to start docker when user selects "y"');
			it('should skip starting docker when user selects "n"');
		});

		describe('Firestore Database', () => {
			it('should not be offered as an option if GCP setup was skipped or failed');
			it('should be offered as an option if GCP setup was successful');
			it('should be offered as an option if GCLOUD_PROJECT is already set in local.env');
			it('should set DATABASE_TYPE=firestore in local.env');
			it('should run the firestore_setup script');
			it('should fail if GCLOUD_PROJECT is not set when selecting firestore');
		});

		describe('Keep Current Setting', () => {
			it('should not change DATABASE_TYPE if "keep" is selected');
			it('should offer to re-run setup for Firestore if it is the current type');
			it('should offer to re-run setup for PostgreSQL if it is the current type');
			it('should not offer to re-run setup for in-memory');
		});
	});

	describe('Application and Shell Configuration', () => {
		it('should prompt for and set SINGLE_USER_EMAIL if not available from gcloud', async function () {
			this.timeout(5 * 60 * 1000);

			const testEmail = 'test.user@example.com';
			const envVars = {
				// Automate all prompts to run non-interactively
				TYPEDAI_TEST_USE_GCP: 'n', // Skip GCP for this basic test
				TYPEDAI_TEST_DB_TYPE: 'inmemory', // Choose the simplest DB
				TYPEDAI_TEST_PYENV_INSTALL_CHOICE: '1', // Install pyenv via script
				TYPEDAI_TEST_FNM_INSTALL_CHOICE: '1', // Install fnm via script
				TYPEDAI_TEST_RG_INSTALL_CHOICE: '1',
				// This is the key variable for this test
				TYPEDAI_TEST_SINGLE_USER_EMAIL: testEmail,
			};

			// In the test Docker container, gcloud is not installed, so getting the email will fail.
			// This will trigger the prompt logic, which is then handled by the env var.
			const result = await runConfigure(envVars);

			expect(result.exitCode, `Configure script failed. Stderr:\n${result.stderr}\nStdout:\n${result.stdout}`).to.equal(0);

			// Check that the script used the test variable because gcloud failed
			expect(result.stdout).to.include('Could not automatically determine SINGLE_USER_EMAIL from gcloud config.');
			expect(result.stdout).to.include('Using TYPEDAI_TEST_SINGLE_USER_EMAIL.');
			expect(result.stdout).to.include(`Set SINGLE_USER_EMAIL to ${testEmail} in ./variables/local.env`);
		});

		it('should run "npm install" in the frontend directory');
		it('should set SINGLE_USER_EMAIL from gcloud config if it is not already set');
		it('should not change SINGLE_USER_EMAIL if it is already set in local.env');
		it('should add TYPEDAI_HOME and bin/path to shell profiles');
		it('should add fnm initialization to shell profiles');
		it('should add pyenv initialization to shell profiles');
		it('should be idempotent when adding configurations to shell profiles (run twice, add once)');
	});

	describe('Non-Interactive (Test) Mode', () => {
		it('should use TYPEDAI_TEST_USE_GCP to control GCP setup');
		it('should use TYPEDAI_TEST_GCLOUD_PROJECT for the project ID');
		it('should use TYPEDAI_TEST_GCLOUD_REGION for the region');
		it('should use TYPEDAI_TEST_GCLOUD_CLAUDE_REGION for the Claude region');
		it('should use TYPEDAI_TEST_SINGLE_USER_EMAIL for the user email');
		it('should use TYPEDAI_TEST_DB_TYPE to select the database');
		it('should use TYPEDAI_TEST_RG_INSTALL_CHOICE for ripgrep installation');
		it('should use TYPEDAI_TEST_FNM_INSTALL_CHOICE for fnm installation');
		it('should use TYPEDAI_TEST_PYENV_INSTALL_CHOICE for pyenv installation');
		it('should use TYPEDAI_TEST_POSTGRES_DOCKER_START for PostgreSQL docker start');
		it('should use TYPEDAI_TEST_RERUN_DB_SETUP when keeping the current DB setting');
	});

	describe('Failure and Edge Cases', () => {
		it('should exit with an error if .node-version file is missing');
		it('should exit with an error if .python-version file is missing');
		it('should exit with an error if a critical setup part (e.g., python_setup) fails');
		it('should exit with an error if run as root in nodejs_setup');
		it('should exit with an error if run as root in python_setup');
	});
});
