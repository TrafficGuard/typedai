const fs = require('fs');
const path = require('path');

function resolveEnvFilePath() {
    const cwd = process.cwd();
    const envFile = process.env.ENV_FILE;
    if (envFile) {
        const candidate = path.isAbsolute(envFile) ? envFile : path.resolve(cwd, envFile);
        if (fs.existsSync(candidate)) return candidate;
    }
    const localEnv = path.resolve(cwd, '../variables/local.env');
    if (fs.existsSync(localEnv)) return localEnv;
    if (process.env.TYPEDAI_HOME) {
        const typedAiEnv = path.resolve(process.env.TYPEDAI_HOME, 'variables/local.env');
        if (fs.existsSync(typedAiEnv)) return typedAiEnv;
    }
    return null;
}

function loadEnvFile(filePath) {
    if (!filePath) return {};
    const contents = fs.readFileSync(filePath, 'utf8');
    const lines = contents.split(/\r?\n/);
    const env = {};
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const equalIndex = line.indexOf('=');
        if (equalIndex <= 0) continue;
        const key = line.substring(0, equalIndex).trim().replace(/^export\s+/, '');
        if (!key) continue;
        let value = line.substring(equalIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value.replace(/\\n/g, '\n');
    }
    return env;
}

function hydrateProcessEnv() {
    const envPath = resolveEnvFilePath();
    if (!envPath) {
        console.warn('No environment file found; relying on existing environment variables.');
        return;
    }
    const vars = loadEnvFile(envPath);
    for (const [key, value] of Object.entries(vars)) {
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

function determineBackendPort() {
    try {
        const runtimePath = path.resolve(process.cwd(), '../.typedai/runtime/backend.json');
        if (fs.existsSync(runtimePath)) {
            const { backendPort } = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
            if (backendPort) return String(backendPort);
        }
    } catch (error) {
        console.warn('Unable to read backend runtime metadata.', error);
    }

    if (process.env.BACKEND_PORT) return process.env.BACKEND_PORT;
    if (process.env.PORT) return process.env.PORT;

    return null;
}

function determineFrontendPort() {
    if (process.env.FRONTEND_PORT) return process.env.FRONTEND_PORT;
    if (process.env.UI_PORT) return process.env.UI_PORT;
    if (process.env.UI_URL) {
        const match = process.env.UI_URL.match(/:(\d+)/);
        if (match) return match[1];
    }
    return null;
}

module.exports = {
    resolveEnvFilePath,
    loadEnvFile,
    hydrateProcessEnv,
    determineBackendPort,
    determineFrontendPort,
};
