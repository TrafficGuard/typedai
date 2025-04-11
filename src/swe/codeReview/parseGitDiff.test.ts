import { expect } from 'chai';
import { type DiffInfo, parseGitDiff } from '#swe/codeReview/parseGitDiff';

describe('parseGitDiff', () => {
	it('should parse a simple modification diff', () => {
		const diffOutput = `
diff --git a/file1.txt b/file1.txt
index 123..456 100644
--- a/file1.txt
+++ b/file1.txt
@@ -1,3 +1,3 @@
 Line 1
-Line 2 old
+Line 2 new
 Line 3
`;
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').with.lengthOf(1);
		const fileInfo = result[0];
		expect(fileInfo.filePath).to.equal('file1.txt');
		expect(fileInfo.oldPath).to.equal('file1.txt');
		expect(fileInfo.newPath).to.equal('file1.txt');
		expect(fileInfo.diff).to.equal('@@ -1,3 +1,3 @@\n Line 1\n-Line 2 old\n+Line 2 new\n Line 3');
		expect(fileInfo.newFile).to.be.false;
		expect(fileInfo.deletedFile).to.be.false;
	});

	it('should parse a new file diff', () => {
		const diffOutput = `
diff --git a/new_file.js b/new_file.js
new file mode 100644
index 0000000..abcde12
--- /dev/null
+++ b/new_file.js
@@ -0,0 +1,2 @@
+console.log('hello');
+const x = 1;
`;
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').with.lengthOf(1);
		const fileInfo = result[0];
		expect(fileInfo.filePath).to.equal('new_file.js');
		expect(fileInfo.oldPath).to.equal('/dev/null');
		expect(fileInfo.newPath).to.equal('new_file.js');
		expect(fileInfo.diff).to.equal("@@ -0,0 +1,2 @@\n+console.log('hello');\n+const x = 1;");
		expect(fileInfo.newFile).to.be.true;
		expect(fileInfo.deletedFile).to.be.false;
	});

	it('should parse a deleted file diff', () => {
		const diffOutput = `
diff --git a/old_config.yaml b/old_config.yaml
deleted file mode 100644
index fedcba9..0000000
--- a/old_config.yaml
+++ /dev/null
@@ -1,1 +0,0 @@
-key: value
`;
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').with.lengthOf(1);
		const fileInfo = result[0];
		expect(fileInfo.filePath).to.equal('old_config.yaml'); // Should use old path for deleted
		expect(fileInfo.oldPath).to.equal('old_config.yaml');
		expect(fileInfo.newPath).to.equal('/dev/null');
		expect(fileInfo.diff).to.equal('@@ -1,1 +0,0 @@\n-key: value');
		expect(fileInfo.newFile).to.be.false;
		expect(fileInfo.deletedFile).to.be.true;
	});

	it('should parse a diff with multiple files', () => {
		const diffOutput = `
diff --git a/src/main.ts b/src/main.ts
index aaa..bbb 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1 +1 @@
-console.log("old");
+console.log("new");
diff --git a/README.md b/README.md
index ccc..ddd 100644
--- a/README.md
+++ b/README.md
@@ -5,2 +5,3 @@
 Some text
+Added line
 More text
`;
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').with.lengthOf(2);

		// Check first file
		expect(result[0].filePath).to.equal('src/main.ts');
		expect(result[0].diff).to.equal('@@ -1 +1 @@\n-console.log("old");\n+console.log("new");');
		expect(result[0].newFile).to.be.false;
		expect(result[0].deletedFile).to.be.false;

		// Check second file
		expect(result[1].filePath).to.equal('README.md');
		expect(result[1].diff).to.equal('@@ -5,2 +5,3 @@\n Some text\n+Added line\n More text');
		expect(result[1].newFile).to.be.false;
		expect(result[1].deletedFile).to.be.false;
	});

	it('should handle file paths with spaces', () => {
		const diffOutput = `
diff --git "a/file with spaces.txt" "b/file with spaces.txt"
index 123..456 100644
--- "a/file with spaces.txt"
+++ "b/file with spaces.txt"
@@ -1 +1 @@
-old content
+new content
`;
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').with.lengthOf(1);
		expect(result[0].filePath).to.equal('file with spaces.txt');
		expect(result[0].oldPath).to.equal('file with spaces.txt');
		expect(result[0].newPath).to.equal('file with spaces.txt');
		expect(result[0].diff).to.equal('@@ -1 +1 @@\n-old content\n+new content');
	});

	it('should handle renamed files (treats as delete + add)', () => {
		// Git often represents renames as a delete and an add, sometimes with similarity index
		const diffOutput = `
diff --git a/old_name.txt b/new_name.txt
similarity index 90%
rename from old_name.txt
rename to new_name.txt
index abc..def 100644
--- a/old_name.txt
+++ b/new_name.txt
@@ -1 +1 @@
-content
+updated content
`;
		// Note: The current parser doesn't explicitly detect renames.
		// It sees the --- a/old_name.txt and +++ b/new_name.txt lines.
		// Depending on how git formats this (sometimes it omits the diff --git line for the delete)
		// the behavior might vary. Let's assume a common format.
		// The current parser will likely create ONE entry based on the --- and +++ lines.
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').with.lengthOf(1);
		expect(result[0].filePath).to.equal('new_name.txt'); // Uses new path as it's not /dev/null
		expect(result[0].oldPath).to.equal('old_name.txt');
		expect(result[0].newPath).to.equal('new_name.txt');
		expect(result[0].diff).to.equal('@@ -1 +1 @@\n-content\n+updated content');
		expect(result[0].newFile).to.be.false; // Because oldPath is not /dev/null
		expect(result[0].deletedFile).to.be.false; // Because newPath is not /dev/null
		// TODO: Enhance parser to detect rename operations if needed.
	});

	it('should return an empty array for empty input', () => {
		const result = parseGitDiff('');
		expect(result).to.be.an('array').that.is.empty;
	});

	it('should return an empty array if input has no @@ hunk headers', () => {
		const diffOutput = `
diff --git a/file1.txt b/file1.txt
index 123..456 100644
--- a/file1.txt
+++ b/file1.txt
diff --git a/file2.txt b/file2.txt
new file mode 100644
index 0000000..e69de29
`;
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').that.is.empty;
	});

	it('should ignore files with no changes after the header', () => {
		const diffOutput = `
diff --git a/no_change.txt b/no_change.txt
index abc..abc 100644
--- a/no_change.txt
+++ b/no_change.txt
`;
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').that.is.empty;
	});

	it('should handle diffs ending abruptly after header', () => {
		const diffOutput = `
diff --git a/file1.txt b/file1.txt
index 123..456 100644
--- a/file1.txt
+++ b/file1.txt
`;
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').that.is.empty;
	});

	it('should handle diffs ending abruptly after hunk header', () => {
		const diffOutput = `
diff --git a/file1.txt b/file1.txt
index 123..456 100644
--- a/file1.txt
+++ b/file1.txt
@@ -1,3 +1,3 @@`; // No content lines after hunk header
		const result = parseGitDiff(diffOutput);
		expect(result).to.be.an('array').with.lengthOf(1);
		expect(result[0].filePath).to.equal('file1.txt');
		expect(result[0].diff).to.equal('@@ -1,3 +1,3 @@'); // Diff contains only the header
	});
});
