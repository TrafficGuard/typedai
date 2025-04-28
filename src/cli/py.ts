import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { type PyodideInterface, loadPyodide } from 'pyodide';
import { PublicWeb } from '#functions/web/web';
import { logger } from '#o11y/logger';

let pyodide: PyodideInterface;
export async function main() {
	pyodide = await loadPyodide();
	pyodide.setDebug(true);
	pyodide.setStdout({
		batched: (output) => {},
	});
	pyodide.setStderr({
		batched: (output) => {},
	});

	const globals = pyodide.toPy({
		web: async () => {
			logger.info('web()');
			const result = await new PublicWeb().takeScreenshotAndLogs('http://localhost:4200/ui/vibe');
			if (typeof result === 'object') {
				for (const [k, v] of Object.entries(result)) {
					console.log(typeof k);
				}
			}
			return result; //[result.logs, result.image];
		},
	});
	const pythonScript = `from typing import Any, List, Dict, Tuple, Optional, Union
async def main():
	try:
		result: Dict[str, Any] = await web()
		# Check if the function returned the expected keys based on its description.
		# Description states: Returns: >} A Buffer containing the screenshot image data in .png format, and the browser logs
		# Description states: -> { image: Buffer; logs: str[]; }
		# Therefore, we expect 'image' and 'logs' keys.
		return {"status": "success", "logs": result.logs}
		#else:
		#	print(f"Function call succeeded but returned unexpected format: {type(result)}")
		#	return {"type": type(result)}

	except Exception as e:
		print(f"Failed to capture screenshot and logs for {target_url}. Error: {e}")
		return {"e": e}
main()
`;
	try {
		const result = await pyodide.runPythonAsync(pythonScript, { globals });
		const pythonScriptResult = result?.toJs ? result.toJs() : result;
		console.log('Result:');
		for (const [k, v] of Object.entries(pythonScriptResult)) {
			console.log(`${k}:${typeof v}`);
			console.log(v);
		}
		if (result?.destroy) result.destroy();
	} catch (e) {
		console.error(e);
	}
	logger.flush();
}
/*
async function compileTest() {
	// const gitlab = new GitLab();

	const jsGlobals = {
		fun1: async () => {
			console.log('In fun1');
			return 'abc';
		},
		getProjects: async () => {
			return await new GitLab().getProjects();
		},
		save: async (value: any) => {
			console.log(typeof value, 'object');
			console.log(`saving ${value}`);
		},
		// search: async(...args) => {return p.research(...args)}
	};
	console.log(jsGlobals);

	pyodide.setStdout({
		batched: (output) => {
			console.log(`Script stdout: ${JSON.stringify(output)}`);
		},
	});
	pyodide.setStderr({
		batched: (output) => {
			console.log(`Script stderr: ${JSON.stringify(output)}`);
		},
	});
	const result = await pyodide.runPythonAsync(
		`
import json
import re
import math
import datetime
from typing import List, Dict, Tuple, Optional, Union
from pyodide.ffi import JsProxy

class JsProxyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, JsProxy):
            return obj.to_py()
        # Let the base class default method raise the TypeError
        return super().default(obj)

async def main():
    res = await fun1()
    print("res " + res)
    projects = await getProjects()
    await save(json.dumps({"projects": projects}, cls=JsProxyEncoder))
    return {"projects": projects}

main()`.trim(),
		{ globals: pyodide.toPy(jsGlobals) },
	);
	logger.info(`1: ${typeof result}`);
	logger.info(`1: ${Object.keys(result).length}`);
	const pythonScriptResult = result?.toJs ? result.toJs() : result;
	logger.info(`2: ${typeof pythonScriptResult}`);
	logger.info(`2: ${Object.keys(pythonScriptResult).length}`);
	console.log('pyodide result:');
	console.log(pythonScriptResult);
	const jsResult = {};
	for (const [key, value] of Object.entries(pythonScriptResult)) {
		jsResult[key] = (value as any)?.toJs ? (value as any).toJs() : value;
	}
	console.log('jsResult result:');
	console.log(jsResult);
}
*/
main().then(
	() => console.log('done'),
	(e) => {
		console.error(e);
		console.error(e.type);
	},
);
