const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const {
    hydrateProcessEnv,
    determineBackendPort,
    determineFrontendPort,
    resolveEnvFilePath,
    loadEnvFile,
} = require('./env-utils');

function findAvailablePort(preferred, attempts = 20) {
    const ports = [];
    if (preferred && Number(preferred) > 0) {
        const base = Number(preferred);
        for (let i = 0; i < attempts; i += 1) ports.push(base + i);
    }
    ports.push(0);

    return new Promise((resolve, reject) => {
        const tryNext = () => {
            if (ports.length === 0) {
                reject(new Error('Unable to find available port for frontend dev server.'));
                return;
            }
            const port = ports.shift();
            const server = net.createServer();
            server.once('error', () => {
                server.close();
                tryNext();
            });
            server.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
                const address = server.address();
                server.close(() => {
                    if (address && typeof address === 'object') {
                        resolve(address.port);
                    } else {
                        resolve(port);
                    }
                });
            });
        };
        tryNext();
    });
}

function ensurePortAvailable(port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', (error) => {
            server.close();
            reject(new Error(`Port ${port} is unavailable: ${error.message}`));
        });
        server.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
            server.close(resolve);
        });
    });
}

function applyEnvFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    const vars = loadEnvFile(filePath);
    for (const [key, value] of Object.entries(vars)) {
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

function writeRuntimeMetadata(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
}

async function main() {
    hydrateProcessEnv();
    applyEnvFile(resolveEnvFilePath());

    const backendPort = determineBackendPort();
    const preferredFrontendPort = determineFrontendPort();
    const repoRoot = path.resolve(process.cwd(), '..');
    const typedAiHome = process.env.TYPEDAI_HOME ? path.resolve(process.env.TYPEDAI_HOME) : null;
    const isDefaultRepo = typedAiHome ? repoRoot === typedAiHome : false;

    let frontendPort;
    if (isDefaultRepo) {
        frontendPort = 4200;
        await ensurePortAvailable(frontendPort);
    } else {
        frontendPort = await findAvailablePort(preferredFrontendPort ? Number(preferredFrontendPort) : 4200);
    }

    process.env.FRONTEND_PORT = String(frontendPort);
    process.env.UI_URL = `http://localhost:${frontendPort}/`;
    if (!process.env.API_BASE_URL && backendPort) {
        process.env.API_BASE_URL = `http://localhost:${backendPort}/api/`;
    }

    console.log('[frontend start] backend port:', backendPort || 'unknown');
    console.log('[frontend start] frontend port:', frontendPort);

    // Generate Angular runtime env file with the resolved variables.
    require('./env.js');

    writeRuntimeMetadata(
        path.resolve(process.cwd(), '../.typedai/runtime/frontend.json'),
        {
            backendPort: backendPort ? Number(backendPort) : undefined,
            frontendPort,
        },
    );

    const ngArgs = ['serve', '--host', '0.0.0.0', '--port', String(frontendPort)];
    const child = spawn('ng', ngArgs, { stdio: 'inherit', shell: process.platform === 'win32' });

    child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        process.exit(typeof code === 'number' ? code : 0);
    });

    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
}

main().catch((error) => {
    console.error('[frontend start] failed to launch Angular dev server:', error);
    process.exit(1);
});
