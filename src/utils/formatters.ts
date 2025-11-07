/**
 * @fileoverview
 * Provides utility functions for formatting strings, such as cleaning ANSI codes.
 */

// import stripAnsi from 'strip-ansi';
const stripAnsi = require('strip-ansi');

/**
 * Cleans a string by removing most ANSI escape codes and converting
 * OSC 8 hyperlinks into Markdown format `[Text](URL)`.
 *
 * This is useful for cleaning log output or shell command results before displaying
 * them in a UI or storing them.
 *
 * @param text The input string, potentially containing ANSI codes.
 * @returns The cleaned string, or an empty string if the input is null/undefined.
 */
export function formatAnsiWithMarkdownLinks(text: string | null | undefined): string {
	if (!text) return '';

	// Regex to match OSC 8 hyperlinks: \x1B]8;;URL\x1B\\Text\x1B]8;;\x1B\\
	// It captures the URL (group 1) and the Text (group 2).
	// Using \x1B for ESC character.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: This is intentional for matching ANSI codes.
	const osc8Regex = /\x1B]8;;(.*?)\x1B\\(.*?)\x1B]8;;\x1B\\/g;

	// First, convert the special OSC 8 links to Markdown format.
	const markdownLinks = text.replace(osc8Regex, '[$2]($1)');

	// Next, use the standard `strip-ansi` library to remove all other ANSI escape codes.
	// This is safer and more reliable than a complex, custom regex.
	return stripAnsi(markdownLinks);
}
