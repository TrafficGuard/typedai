/**
 * CLI Interaction Provider
 *
 * Terminal readline implementation of UserInteractionProvider.
 * Creates fresh readline interfaces to avoid stdin closure issues.
 */

import readline from 'node:readline';
import type { ApprovalRequest, ApprovalResponse, UserInteractionProvider } from './userInteraction';

/**
 * CLI implementation of UserInteractionProvider using terminal readline.
 *
 * Key feature: Creates fresh readline interfaces for each interaction
 * to avoid ERR_USE_AFTER_CLOSE when other agents close stdin.
 */
export class CliInteractionProvider implements UserInteractionProvider {
	private rl: readline.Interface | null = null;

	/**
	 * Ensures a working readline interface exists.
	 * Creates a fresh one if the previous was closed.
	 */
	private ensureReadline(): readline.Interface {
		// Always create fresh readline to avoid closed stdin issues
		if (this.rl) {
			try {
				this.rl.close();
			} catch {
				// Ignore close errors
			}
		}

		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		return this.rl;
	}

	/**
	 * Prompts user for input
	 */
	private prompt(rl: readline.Interface, question: string): Promise<string> {
		return new Promise((resolve) => {
			rl.question(question, (answer) => {
				resolve(answer);
			});
		});
	}

	/**
	 * Request approval from the user with options.
	 */
	async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		const rl = this.ensureReadline();

		// Display header
		console.log(`\n${'='.repeat(60)}`);
		console.log(request.title);
		console.log('='.repeat(60));
		console.log(request.summary);

		// Display details if provided
		if (request.details) {
			console.log('');
			console.log(request.details);
		}

		// Display options
		console.log('\nOptions:');
		request.options.forEach((opt, i) => {
			const defaultMarker = opt.isDefault ? ' (default)' : '';
			const description = opt.description ? ` - ${opt.description}` : '';
			console.log(`  ${i + 1}. ${opt.label}${defaultMarker}${description}`);
		});

		// Get user input
		const answer = await this.prompt(rl, '\nYour choice (number or feedback): ');
		const trimmed = answer.trim();

		// Check if it's a number selection
		const num = Number.parseInt(trimmed, 10);
		if (num >= 1 && num <= request.options.length) {
			return { optionId: request.options[num - 1].id };
		}

		// Empty input selects default
		if (trimmed === '') {
			const defaultOption = request.options.find((o) => o.isDefault) ?? request.options[0];
			return { optionId: defaultOption.id };
		}

		// Common shortcuts
		if (trimmed.toLowerCase() === 'y' || trimmed.toLowerCase() === 'yes') {
			const approveOption = request.options.find((o) => o.id === 'approve' || o.id === 'continue');
			if (approveOption) {
				return { optionId: approveOption.id };
			}
		}

		if (trimmed.toLowerCase() === 'n' || trimmed.toLowerCase() === 'no') {
			const abortOption = request.options.find((o) => o.id === 'abort');
			if (abortOption) {
				return { optionId: abortOption.id };
			}
		}

		// Treat anything else as feedback
		return { optionId: 'feedback', feedback: trimmed };
	}

	/**
	 * Send a notification to the user (just prints to console).
	 */
	async notify(title: string, message: string, priority?: 'low' | 'normal' | 'high'): Promise<void> {
		const icon = priority === 'high' ? '🚨' : priority === 'low' ? 'ℹ️' : '📢';
		console.log(`\n${icon} ${title}: ${message}`);
	}

	/**
	 * Clean up readline resources.
	 */
	close(): void {
		if (this.rl) {
			try {
				this.rl.close();
			} catch {
				// Ignore close errors
			}
			this.rl = null;
		}
	}
}
