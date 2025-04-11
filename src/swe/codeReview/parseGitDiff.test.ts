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
`

	// Implement all required tests
	it("should", () => {})
});
