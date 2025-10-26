import { expect } from 'chai';
import { type PyodideInterface, loadPyodide } from 'pyodide';
import type { FunctionSchema } from '#functionSchema/functions';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { generatePythonWrapper } from './codegenAutonomousAgent';
import { mainFnCodeToFullScript } from './pythonCodeGenUtils';

describe('Pyodide deep conversion in wrappers', () => {
	setupConditionalLoggerOutput();
	let py: PyodideInterface;

	before(async function () {
		this.timeout(60000);
		py = await loadPyodide();
	});

	it('allows subscripting and membership on returned arrays/dicts', async function () {
		this.timeout(30000);

		const schemas: FunctionSchema[] = [
			{ class: 'GitLab', name: 'GitLab_getProjects', description: 'list projects', returns: '', parameters: [], returnType: 'Array<Record<string, any>>' },
		];
		// Ensure wrapper is generated for this function by including the name in "generatedPythonCode"
		const wrapper = generatePythonWrapper(schemas, 'await GitLab_getProjects()');

		const main = `
projects = await GitLab_getProjects()
first = projects[0]
owner_name = first['owner']['name']
ok = 'group/subgroup' in first['fullPath']

# Count matches across the list
count = 0
for p in projects:
    if 'group/subgroup' in p['fullPath']:
        count += 1

# Mutate nested field to ensure dict/list semantics work
first['processed'] = True

return {
    'ok': ok,
    'count': count,
    'ownerName': owner_name,
    'firstName': first['name'],
    'processed': first['processed'],
    'length': len(projects),
}
		`.trim();

		const script = wrapper + mainFnCodeToFullScript(main);

		const projects = [
			{ name: 'project-a', fullPath: 'group/subgroup/project-a', owner: { name: 'team-a' } },
			{ name: 'project-b', fullPath: 'group/subgroup/project-b', owner: { name: 'team-b' } },
		];

		const globals = py.toPy({
			_GitLab_getProjects: async () => projects,
		});

		const pyResult: any = await py.runPythonAsync(script, { globals });
		const result = pyResult?.toJs ? pyResult.toJs({ dict_converter: Object.fromEntries }) : pyResult;
		if (pyResult?.destroy) pyResult.destroy?.();

		expect(result.ok).to.equal(true);
		expect(result.count).to.equal(2);
		expect(result.ownerName).to.equal('team-a');
		expect(result.firstName).to.equal('project-a');
		expect(result.processed).to.equal(true);
		expect(result.length).to.equal(2);
	});

	it('supports deep list/dict manipulation of returned structures', async function () {
		this.timeout(30000);

		const schemas: FunctionSchema[] = [
			{ class: 'TestApi', name: 'Api_getData', description: 'get data', returns: '', parameters: [], returnType: 'Record<string, any>' },
		];
		const wrapper = generatePythonWrapper(schemas, 'await Api_getData()');

		const main = `
data = await Api_getData()

# Mutate nested list and compute aggregate from nested dict
data['items'][0]['tags'].append('new')
total = sum([v for v in data['metrics'].values()])

return {
    'firstTags': data['items'][0]['tags'],
    'total': total,
    'hasNew': 'new' in data['items'][0]['tags'],
    'hasNewInOriginal': 'new' in data['items'][0]['tags'], # Check if original object is modified
}
		`.trim();

		const script = wrapper + mainFnCodeToFullScript(main);

		const jsData = {
			items: [
				{ id: 1, tags: ['a', 'b'] },
				{ id: 2, tags: [] },
			],
			metrics: { a: 1, b: 2, c: 3 },
		};

		const globals = py.toPy({
			_Api_getData: async () => jsData,
		});

		const pyResult: any = await py.runPythonAsync(script, { globals });
		const result = pyResult?.toJs ? pyResult.toJs({ dict_converter: Object.fromEntries }) : pyResult;
		if (pyResult?.destroy) pyResult.destroy?.();

		expect(result.firstTags).to.deep.equal(['a', 'b', 'new']);
		expect(result.total).to.equal(6);
		expect(result.hasNew).to.equal(true);
		// Ensure the original JS object is NOT modified by Python operations
		expect(jsData.items[0].tags).to.deep.equal(['a', 'b']);
	});
});
