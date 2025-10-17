import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const server = new McpServer({
	name: 'tpyedai-server',
	version: '1.0.0',
});

// server.registerTool(
//     'localSearch',
//     {
//         title: 'Fast search',
//         description: 'Performans a fast local search of the codebase',
//         inputSchema: { workingDirectory: z.string(), query: z.string() },
//         outputSchema: { result: z.string(), files: z.array(z.string()) }
//     },
//     async ({ workingDirectory, query }) => {
//         const output = { result: a + b };
//         return {
//             content: [{ type: 'text', text: JSON.stringify(output) }],
//             structuredContent: output
//         };
//     }
// );
