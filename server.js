/**
 * SAP Context Builder - Backend Server
 * * This server handles local file system access, communication with GitHub (via ContextPacker),
 * and serves the frontend UI. It is strictly configured for local execution.
 */

// 1. Initialize Environment Variables from the .env file
require('dotenv').config(); 

const express = require('express');
const path = require('path');
const fs = require('fs');

// Internal module to handle the logic of traversing directories and fetching GitHub content
const ContextPacker = require('./src/contextPacker');

/**
 * SECURITY GUARDRAIL: enforceLocalExecutionOnly
 * Checks for common cloud environment variables and the NODE_ENV flag.
 * If detected, the process terminates to prevent unauthorized remote hosting.
 */
function enforceLocalExecutionOnly() {
    const cloudEnvVars = [
        'DYNO', 'AWS_REGION', 'AWS_EXECUTION_ENV', 'VERCEL', 'RENDER',
        'FLY_REGION', 'RAILWAY_ENVIRONMENT', 'KUBERNETES_SERVICE_HOST',
        'GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'AZURE_FUNCTIONS_ENVIRONMENT', 'CODESPACES'
    ];

    // Check if any known cloud-provider environment variables are present
    const isCloudEnv = cloudEnvVars.some(envVar => process.env[envVar] !== undefined);
    const isProduction = process.env.NODE_ENV === 'production';

    if (isCloudEnv || isProduction) {
        console.error("Cloud environment detected. Local execution only. Exiting.");
        process.exit(1);
    }
}

// Execute the guardrail immediately on startup
enforceLocalExecutionOnly();

const app = express();

/**
 * MIDDLEWARE: IP Filtering
 * Ensures that only requests coming from the local machine (localhost) are processed.
 */
app.use((req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const allowedLocalIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

    if (!allowedLocalIps.includes(clientIp)) {
        console.warn(`Blocked remote access attempt from IP: ${clientIp}`);
        return res.status(403).json({
            error: "403 Forbidden",
            message: "Local access only."
        });
    }

    next();
});

// Configure Express to handle large payloads (required for packing large repositories)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve the frontend assets from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Temporary server-side memory to hold the last compiled context
let serverMemoryChunks = [];

/**
 * API: GET /api/config
 * Retrieves the global configuration (ignore lists, extensions) for the UI.
 */
app.get('/api/config', (req, res) => {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        res.sendFile(configPath);
    } else {
        res.status(404).json({ error: "Config file not found." });
    }
});

/**
 * API: GET /api/prompt
 * Reads the master system instruction template from a text file.
 */
app.get('/api/prompt', async (req, res) => {
    try {
        const promptPath = path.join(__dirname, 'default-prompt.txt');
        const content = await fs.promises.readFile(promptPath, 'utf8');
        res.send(content);
    } catch (error) {
        res.status(404).send("Default prompt file not found.");
    }
});

/**
 * API: POST /api/pack
 * The core orchestration endpoint. Receives source paths/URLs, compiles the code
 * based on extensions, and returns the result in XML chunks.
 */
app.post('/api/pack', async (req, res) => {
    try {
        const { sources, extensions, aiPrompt, sessionToken } = req.body;

        // Load configuration to determine character limits and ignore rules
        const configPath = path.join(__dirname, 'config.json');
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        const characterLimit = configData.maxCharsPerChunk || 45000;
        const ignoreDirs = configData.ignoreDirs || [];
        const ignoreFiles = configData.ignoreFiles || [];

        /**
         * TOKEN LOGIC:
         * Priority 1: sessionToken (Passed from the browser's volatile storage)
         * Priority 2: GITHUB_TOKEN (Pulled from the local .env file)
         */
        const activeToken = sessionToken || process.env.GITHUB_TOKEN;

        // Call the packer logic to build the XML context
        serverMemoryChunks = await ContextPacker.compile(
            sources,
            extensions,
            aiPrompt,
            activeToken,
            characterLimit,
            ignoreDirs,
            ignoreFiles
        );

        // Return the compiled chunks to the frontend
        res.json({ chunks: serverMemoryChunks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Configure port and start the listener strictly on the local loopback address
const PORT = process.env.PORT || 3000;

app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
});