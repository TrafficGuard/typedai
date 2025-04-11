import { expect } from 'chai';
import { type DiffInfo, parseGitDiff } from '#swe/codeReview/parseGitDiff';

describe('parseGitDiff', () => {
	const diff = `diff --git a/file1.ts b/file1.ts
index e4c2480..fb74586 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,5 +1,9 @@
-import {Foo} from "./file2";
+import {Foo} from "./src/file2";
 
-class App {
+export class App {
     constructor(private foo: Foo) {}
+
+    async foobar() {
+        await this.foo.bar();
+    }
 }
\\ No newline at end of file
diff --git a/file3.ts b/file3.ts
deleted file mode 100644
index 7e6846b..0000000
--- a/file3.ts
+++ /dev/null
@@ -1,5 +0,0 @@
-async function main() {
-    console.log("Hello from file3!");
-}
-
-main().catch(console.error)
diff --git a/main.ts b/main.ts
new file mode 100644
index 0000000..7fc4cb9
--- /dev/null
+++ b/main.ts
@@ -0,0 +1,9 @@
+import {App} from "./file1";
+import {Foo} from "./src/file2";
+
+async function main() {
+    console.log("Hello from main!");
+    await new App(new Foo()).foobar();
+}
+
+main().catch(console.error)
diff --git a/file2.ts b/src/file2.ts
similarity index 71%
rename from file2.ts
rename to src/file2.ts
index 72fb9ce..c11a4a7 100644
--- a/file2.ts
+++ b/src/file2.ts
@@ -7,4 +7,8 @@ export class Foo {
     baz(): string {
         return "42";
     }
+
+    toString() {
+        return this.baz();
+    }
 }
\\ No newline at end of file
diff --git a/temp.ts b/temp.ts
deleted file mode 100644
index ffbe9e6..0000000
--- a/temp.ts
+++ /dev/null
@@ -1,6 +0,0 @@
-
-export class Temp {
-    async peek(): Promise<void> {
-        console.log('peek');
-    }
-}
\\ No newline at end of file
`;

	let parsedDiff: DiffInfo[];

	before(() => {
		parsedDiff = parseGitDiff(diff);
	});

	it('should parse the correct number of files', () => {
		expect(parsedDiff).to.be.an('array').with.lengthOf(5);
	});

	it('should correctly parse the modified file (file1.ts)', () => {
		const fileInfo = parsedDiff.find((f) => f.filePath === 'file1.ts');
		expect(fileInfo).to.exist;
		expect(fileInfo?.oldPath).to.equal('file1.ts');
		expect(fileInfo?.newPath).to.equal('file1.ts');
		expect(fileInfo?.deletedFile).to.be.false;
		expect(fileInfo?.newFile).to.be.false;
		expect(fileInfo?.diff).to.equal(
			'@@ -1,5 +1,9 @@\n' +
				'-import {Foo} from "./file2";\n' +
				'+import {Foo} from "./src/file2";\n' +
				' \n' +
				'-class App {\n' +
				'+export class App {\n' +
				'     constructor(private foo: Foo) {}\n' +
				'+\n' +
				'+    async foobar() {\n' +
				'+        await this.foo.bar();\n' +
				'+    }\n' +
				' }\n' +
				'\\ No newline at end of file',
		);
	});

	it('should correctly parse the deleted file (file3.ts)', () => {
		const fileInfo = parsedDiff.find((f) => f.filePath === 'file3.ts');
		expect(fileInfo).to.exist;
		expect(fileInfo?.oldPath).to.equal('file3.ts');
		expect(fileInfo?.newPath).to.equal('/dev/null');
		expect(fileInfo?.deletedFile).to.be.true;
		expect(fileInfo?.newFile).to.be.false;
		expect(fileInfo?.diff).to.equal(
			'@@ -1,5 +0,0 @@\n' + '-async function main() {\n' + '-    console.log("Hello from file3!");\n' + '-}\n' + '-\n' + '-main().catch(console.error)',
		);
	});

	it('should correctly parse the added file (main.ts)', () => {
		const fileInfo = parsedDiff.find((f) => f.filePath === 'main.ts');
		expect(fileInfo).to.exist;
		expect(fileInfo?.oldPath).to.equal('/dev/null');
		expect(fileInfo?.newPath).to.equal('main.ts');
		expect(fileInfo?.deletedFile).to.be.false;
		expect(fileInfo?.newFile).to.be.true;
		expect(fileInfo?.diff).to.equal(
			'@@ -0,0 +1,9 @@\n' +
				'+import {App} from "./file1";\n' +
				'+import {Foo} from "./src/file2";\n' +
				'+\n' +
				'+async function main() {\n' +
				'+    console.log("Hello from main!");\n' +
				'+    await new App(new Foo()).foobar();\n' +
				'+}\n' +
				'+\n' +
				'+main().catch(console.error)',
		);
	});

	it('should correctly parse the renamed/moved and modified file (src/file2.ts)', () => {
		// Note: The parser identifies this based on --- and +++ lines, not the 'rename from/to' lines explicitly.
		const fileInfo = parsedDiff.find((f) => f.filePath === 'src/file2.ts');
		expect(fileInfo).to.exist;
		expect(fileInfo?.oldPath).to.equal('file2.ts');
		expect(fileInfo?.newPath).to.equal('src/file2.ts');
		expect(fileInfo?.deletedFile).to.be.false;
		expect(fileInfo?.newFile).to.be.false; // Not technically a new file as oldPath isn't /dev/null
		expect(fileInfo?.diff).to.equal(
			'@@ -7,4 +7,8 @@ export class Foo {\n' +
				'     baz(): string {\n' +
				'         return "42";\n' +
				'     }\n' +
				'+\n' +
				'+    toString() {\n' +
				'+        return this.baz();\n' +
				'+    }\n' +
				' }\n' +
				'\\ No newline at end of file',
		);
	});

	it('should correctly parse the second deleted file (temp.ts)', () => {
		const fileInfo = parsedDiff.find((f) => f.filePath === 'temp.ts');
		expect(fileInfo).to.exist;
		expect(fileInfo?.oldPath).to.equal('temp.ts');
		expect(fileInfo?.newPath).to.equal('/dev/null');
		expect(fileInfo?.deletedFile).to.be.true;
		expect(fileInfo?.newFile).to.be.false;
		expect(fileInfo?.diff).to.equal(
			'@@ -1,6 +0,0 @@\n' +
				'-\n' +
				'-export class Temp {\n' +
				'-    async peek(): Promise<void> {\n' +
				"-        console.log('peek');\n" +
				'-    }\n' +
				'-}\n' +
				'\\ No newline at end of file',
		);
	});
});
