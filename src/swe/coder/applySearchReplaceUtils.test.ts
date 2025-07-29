import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { stripFilename } from './applySearchReplaceUtils';

describe('stripFilename', () => {
	setupConditionalLoggerOutput();

	const FENCE = '```';

	const testCases: Array<[string, string | undefined, string?]> = [
		// input, expected output, description
		['myfile.py', 'myfile.py', 'Simple filename'],
		['  myfile.py  ', 'myfile.py', 'Filename with surrounding spaces'],
		['myfile.py:', 'myfile.py', 'Filename with trailing colon'],
		['# myfile.py', 'myfile.py', 'Filename with leading hash'],
		['`myfile.py`', 'myfile.py', 'Filename with backticks'],
		['*myfile.py*', 'myfile.py', 'Filename with asterisks'],
		['my\\_file.py', 'my_file.py', 'Filename with escaped underscore'],
		['path/to/my file.py', 'path/to/my file.py', 'Filename with spaces and path'],
		['...', undefined, 'Ellipsis only'],
		['  ...  ', undefined, 'Ellipsis with spaces'],
		[FENCE, undefined, 'Fence only'],
		[`${FENCE}python`, undefined, 'Fence with language only'],
		[`${FENCE}python myfile.py`, 'myfile.py', 'Fence with language and filename'],
		[`${FENCE} myfile.py`, 'myfile.py', 'Fence with filename only (space after fence)'],
		[`   ${FENCE}python myfile.py  `, 'myfile.py', 'Fence with lang and filename, surrounding spaces'],
		[`${FENCE}py path/to/file.py`, 'path/to/file.py', 'Fence with short lang and path'],
		['<file>', undefined, 'Starts with <'],
		['=file=', undefined, 'Starts with ='],
		['', undefined, 'Empty string'],
		['    ', undefined, 'Whitespace string'],
		[`${FENCE}javascript path/to/some/file.js`, 'path/to/some/file.js', 'JS file with path'],
		[`  ${FENCE} path/to/another file.txt`, 'path/to/another file.txt', 'Text file with path and spaces'],
		['foo.py', 'foo.py', 'simple'],
		['  foo.py', 'foo.py', 'leading space'],
		['foo.py  ', 'foo.py', 'trailing space'],
		['`foo.py`', 'foo.py', 'backticks'],
		['*foo.py*', 'foo.py', 'asterisks'],
		['foo.py:', 'foo.py', 'colon'],
		['# foo.py', 'foo.py', 'hash'],
		['#foo.py', 'foo.py', 'hash no space'],
		// The current JS code will produce 'foo.py' for '# `foo.py`' after stripping '#' then '`'.
		['# `foo.py`', 'foo.py', 'hash with backticks (JS behavior)'],
		['```python foo.py', 'foo.py', 'fenced python'],
		['``` foo.py', 'foo.py', 'fenced no lang'],
		['```python # foo.py', '# foo.py', 'fenced python with hash'],
		['```python foo.py # comment', 'foo.py # comment', 'fenced python with comment'],
		['```python', undefined, 'fenced python no file'],
		['```', undefined, 'fenced no lang no file'],
		['foo_bar.py', 'foo_bar.py', 'Filename with underscore'],
		['foo\\_bar.py', 'foo_bar.py', 'Filename with escaped underscore (literal backslash)'],
		[`${FENCE}python\nfoo.py`, undefined, 'Malformed fence with newline (should be undefined)'],
		[`${FENCE}cpp src/my_class.cpp`, 'src/my_class.cpp', 'C++ file with path'],
		[`  ${FENCE}java com/example/Main.java  `, 'com/example/Main.java', 'Java file with path and spaces'],
		['foo.bar.baz.txt', 'foo.bar.baz.txt', 'Filename with multiple dots'],
	];

	testCases.forEach(([input, expected, description]) => {
		it(`should return '${expected}' for input '${input}' (${description})`, () => {
			expect(stripFilename(input, FENCE)).to.equal(expected);
		});
	});

	// Test with a different fence
	const CUSTOM_FENCE = '+++';
	it('should work with a custom fence', () => {
		expect(stripFilename(`${CUSTOM_FENCE}ruby my_script.rb`, CUSTOM_FENCE)).to.equal('my_script.rb');
	});
	it('should return undefined for custom fence only', () => {
		expect(stripFilename(CUSTOM_FENCE, CUSTOM_FENCE)).to.equal(undefined);
	});
	it('should return undefined for custom fence with lang only', () => {
		expect(stripFilename(`${CUSTOM_FENCE}python`, CUSTOM_FENCE)).to.equal(undefined);
	});
});
