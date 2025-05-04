import { Buffer } from 'node:buffer';
// File: pyodide-buffer-test-final-v5.ts
import { type PyodideInterface, loadPyodide } from 'pyodide';

async function runPyodideConversionTest() {
	console.log('Initializing Pyodide...');
	let pyodide: PyodideInterface | null = null;
	try {
		pyodide = await loadPyodide();

		pyodide.setStdout({
			batched: (output) => {
				const trimmedOutput = output.endsWith('\n') ? output.slice(0, -1) : output;
				console.log(`stdout: ${JSON.stringify(trimmedOutput)}`);
			},
		});
		pyodide.setStderr({
			batched: (output) => {
				const trimmedOutput = output.endsWith('\n') ? output.slice(0, -1) : output;
				console.log(`stderr: ${JSON.stringify(trimmedOutput)}`);
			},
		});

		console.log('Pyodide initialized and streams configured.');

		const testLogs = ['log entry 1', 'status update', 'log entry 3'];
		const testBuffer = Buffer.from('This is sample buffer data for the test.');
		// *** Convert Buffer to Uint8Array ***
		// Ensure we get the underlying ArrayBuffer correctly from the Node Buffer
		const testUint8Array = new Uint8Array(testBuffer.buffer, testBuffer.byteOffset, testBuffer.byteLength);
		console.log(`JS Buffer type: ${testBuffer.constructor.name}, length: ${testBuffer.length}`);
		console.log(`JS Uint8Array type: ${testUint8Array.constructor.name}, length: ${testUint8Array.length}`);

		// --- JS Functions (Return Uint8Array instead of Buffer) ---
		const getOriginalObject = async () => {
			console.log('\nJS: getOriginalObject called');
			const result = {
				logs: testLogs,
				image: testUint8Array, // <--- Return Uint8Array
				description: 'Original JS Object',
			};
			console.log(`JS: Returning object with constructor: ${result.constructor.name}`);
			return result;
		};
		const getRestructuredObject = async () => {
			console.log('\nJS: getRestructuredObject called');
			const originalResult = {
				logs: testLogs,
				image: testUint8Array, // <--- Return Uint8Array
				description: 'Restructured JS Object',
			};
			const result = { ...originalResult };
			console.log(`JS: Returning restructured object with constructor: ${result.constructor.name}`);
			return result;
		};
		const getArray = async () => {
			console.log('\nJS: getArray called');
			const result = [
				testLogs,
				testUint8Array, // <--- Return Uint8Array
				'Simple Array',
			];
			console.log(`JS: Returning array with constructor: ${result.constructor.name}`);
			return result;
		};

		// Pass functions directly as globals
		const globals: any = pyodide.toPy({
			getOriginalObject_js: getOriginalObject,
			getRestructuredObject_js: getRestructuredObject,
			getArray_js: getArray,
		});

		// --- Python Script (Keep Direct Access logic, fix asyncio) ---
		const pythonScript = `
from pyodide.ffi import JsProxy
import sys
import traceback
import asyncio

print("--- Python Script Start ---")

async def run_test():
    # Test 1: Original Object - Access properties directly
    print("\\n--- Testing Original Object (Direct Access) ---")
    try:
        result_obj_proxy = await getOriginalObject_js() # Expecting JsProxy
        print(f"Python received type: {type(result_obj_proxy)}")

        if isinstance(result_obj_proxy, JsProxy):
            print("Result is JsProxy. Accessing properties directly...")
            try:
                # Access logs
                logs_val = result_obj_proxy.logs
                print(f"  Accessed .logs, type: {type(logs_val)}, repr: {repr(logs_val)}")
                if isinstance(logs_val, JsProxy):
                     try:
                         py_list = logs_val.to_py()
                         print(f"    logs_val.to_py() result type: {type(py_list)}")
                     except Exception as e_log_to_py:
                         print(f"    Error calling logs_val.to_py(): {e_log_to_py}", file=sys.stderr)

                # Access image (should be JsProxy(Uint8Array))
                image_val = result_obj_proxy.image
                print(f"  Accessed .image, type: {type(image_val)}, repr: {repr(image_val)}")
                if isinstance(image_val, JsProxy):
                    print(f"    image_val is JsProxy as expected.")
                    try:
                        # Check its JS constructor name via the proxy
                        print(f"    image_val.constructor.name: {image_val.constructor.name}")
                        # Try converting the Uint8Array proxy to a Python memoryview
                        print(f"    Attempting image_val.to_py()...")
                        mem_view = image_val.to_py()
                        print(f"    image_val.to_py() type: {type(mem_view)}")
                        print(f"    memoryview length: {len(mem_view)}")
                        # Accessing memoryview content (example)
                        # print(f"    memoryview content (first 10 bytes): {bytes(mem_view[:10])}")
                    except Exception as e_img_access:
                        print(f"    Error processing image_val proxy: {e_img_access}", file=sys.stderr)
                        traceback.print_exc(file=sys.stderr) # Print traceback for this error

                # Access description
                desc_val = result_obj_proxy.description
                print(f"  Accessed .description, type: {type(desc_val)}, repr: {repr(desc_val)}")

            except Exception as e_access:
                # This catches errors during property access itself
                print(f"  Error accessing properties directly: {e_access}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
        else:
             print(f"Received unexpected type (not JsProxy): {type(result_obj_proxy)}")

    except Exception as e:
        # This catches errors in the overall test block, e.g., the await call
        print(f"*** Error testing original object: {e} ***", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    # Test 2: Restructured Object - Access properties directly
    print("\\n--- Testing Restructured Object (Direct Access) ---")
    try:
        result_restructured_proxy = await getRestructuredObject_js()
        print(f"Python received type: {type(result_restructured_proxy)}")
        if isinstance(result_restructured_proxy, JsProxy):
            print("Result is JsProxy. Accessing properties directly...")
            try:
                logs_val = result_restructured_proxy.logs
                print(f"  Accessed .logs, type: {type(logs_val)}")
                image_val = result_restructured_proxy.image
                print(f"  Accessed .image, type: {type(image_val)}")
                desc_val = result_restructured_proxy.description
                print(f"  Accessed .description, type: {type(desc_val)}")
                # Add detailed inspection of image_val proxy here too if needed
                if isinstance(image_val, JsProxy):
                    print(f"    Attempting image_val.to_py() for restructured...")
                    mem_view_restructured = image_val.to_py()
                    print(f"    Restructured image_val.to_py() type: {type(mem_view_restructured)}")
                    print(f"    Restructured memoryview length: {len(mem_view_restructured)}")

            except Exception as e_access:
                 print(f"  Error accessing properties directly: {e_access}", file=sys.stderr)
                 traceback.print_exc(file=sys.stderr)
        else:
             print(f"Received unexpected type (not JsProxy): {type(result_restructured_proxy)}")
    except Exception as e:
        print(f"*** Error testing restructured object: {e} ***", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)


    # Test 3: Array - Access elements directly
    print("\\n--- Testing Array (Direct Access) ---")
    try:
        result_array_proxy = await getArray_js() # Expecting JsProxy
        print(f"Python received type: {type(result_array_proxy)}")
        if isinstance(result_array_proxy, JsProxy):
             print("Result is JsProxy. Accessing elements by index...")
             try:
                 # Access logs (index 0)
                 logs_item = result_array_proxy[0]
                 print(f"  Accessed [0] (logs), type: {type(logs_item)}, repr: {repr(logs_item)}")
                 if isinstance(logs_item, JsProxy):
                     try:
                         py_list = logs_item.to_py()
                         print(f"    logs_item.to_py() result type: {type(py_list)}")
                     except Exception as e_log_to_py:
                         print(f"    Error calling logs_item.to_py(): {e_log_to_py}", file=sys.stderr)

                 # Access image (index 1)
                 image_item = result_array_proxy[1]
                 print(f"  Accessed [1] (image), type: {type(image_item)}, repr: {repr(image_item)}")
                 if isinstance(image_item, JsProxy):
                     print(f"    image_item is JsProxy as expected.")
                     try:
                         print(f"    image_item.constructor.name: {image_item.constructor.name}")
                         # Try converting the Uint8Array proxy to a Python memoryview
                         print(f"    Attempting image_item.to_py()...")
                         mem_view_array = image_item.to_py()
                         print(f"    image_item.to_py() type: {type(mem_view_array)}")
                         print(f"    Array memoryview length: {len(mem_view_array)}")
                     except Exception as e_img_access:
                        print(f"    Error processing image_item proxy: {e_img_access}", file=sys.stderr)
                        traceback.print_exc(file=sys.stderr)

                 # Access description (index 2)
                 desc_item = result_array_proxy[2]
                 print(f"  Accessed [2] (description), type: {type(desc_item)}, repr: {repr(desc_item)}")

             except Exception as e_access:
                 # This catches errors during element access itself
                 print(f"  Error accessing elements by index: {e_access}", file=sys.stderr)
                 traceback.print_exc(file=sys.stderr)
        else:
             print(f"Received unexpected type (not JsProxy): {type(result_array_proxy)}")

    except Exception as e:
        print(f"*** Error testing array: {e} ***", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

await run_test()

None
`; // End of Python script string

		console.log('\nRunning Python script...');
		const result = await pyodide.runPythonAsync(pythonScript, { globals: globals });
		console.log('Python script finished.');
	} catch (error) {
		console.error('Error during Pyodide test:', error);
		if (error.constructor.name === 'PythonError') {
			console.error('PythonError type:', error.type);
			console.error('PythonError message:', error.message);
		}
	} finally {
		console.log('\nTest script finished.');
	}
}

runPyodideConversionTest().catch(console.error);
