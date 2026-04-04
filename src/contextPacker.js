const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const tar = require('tar');

/**
 * ContextPacker
 * Orchestrates the secure extraction and compilation of local and remote repositories 
 * into compressed XML chunks optimized for AI ingestion.
 */
class ContextPacker {
    
    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Master orchestration method. Routes sources to local or remote handlers, 
     * builds the structural blueprint, and packs the final chunked array.
     * * @param {Array} sources - Array of objects containing {type: 'local'|'github', path: string}
     * @param {Array} extensions - Array of file extensions to include (e.g., ['.js', '.abap'])
     * @param {string} aiPrompt - The master system instructions for the AI
     * @param {string} gitHubToken - The active PAT (from SessionStorage or .env) used for API auth
     * @param {number} maxChars - The maximum character length per output chunk
     * @param {Array} ignoreDirs - Directories to skip during traversal
     * @param {Array} ignoreFiles - Specific files to skip
     * @param {number} maxFileSizeBytes - Max allowed size per file to prevent heap crashes
     * @returns {Promise<Array<string>>} Array of XML-formatted string chunks
     */
    static async compile(sources, extensions, aiPrompt, gitHubToken, maxChars = 90000, ignoreDirs = [], ignoreFiles = [], maxFileSizeBytes = 128000) {
        const fileManifest = [];     // Holds the final {path, content} for every valid file
        const repositoryNames = [];  // Holds names of processed repos for the blueprint

        // 1. Process each source sequentially
        for (const source of sources) {
            let sourcePrefix = '';

            if (source.type === 'local') {
                // Determine root folder name for local paths
                sourcePrefix = path.basename(path.resolve(source.path));
                repositoryNames.push(sourcePrefix);
                
                // Traverse local file system
                await this._readDirectory(source.path, source.path, extensions, fileManifest, ignoreDirs, ignoreFiles, maxFileSizeBytes, 0, sourcePrefix);
            
            } else if (source.type === 'github') {
                // Parse GitHub URL to get repo name
                const urlObj = new URL(source.path);
                sourcePrefix = path.basename(urlObj.pathname, '.git');
                repositoryNames.push(sourcePrefix);
                
                // Fetch and extract remote repository
                await this._processRemoteRepository(source.path, extensions, fileManifest, gitHubToken, ignoreDirs, ignoreFiles, maxFileSizeBytes, sourcePrefix);
            }
        }

        // 2. Generate the directory tree map for the AI prompt
        const treeMap = this._generateProjectBlueprint(fileManifest);
        const repoListText = repositoryNames.map(name => `- ${name}`).join('\n');
        
        // 3. Inject the project architecture into the user's base prompt
        const enhancedPrompt = `${aiPrompt}\n\n=== INCLUDED REPOSITORIES ===\nThe following distinct repositories have been aggregated into this context:\n${repoListText}\n\n=== REPOSITORY ARCHITECTURE ===\n${treeMap}`;

        // 4. Split the aggregated files into appropriately sized XML chunks
        return this._chunkPayload(fileManifest, enhancedPrompt, maxChars);
    }

    // =========================================================================
    // STATELESS REMOTE REPOSITORY HANDLING (REST API)
    // =========================================================================

    /**
     * Downloads a repository via the GitHub REST API and streams it directly to a 
     * native extraction engine in the OS temp folder.
     */
    static async _processRemoteRepository(repoUrl, extensions, fileManifest, token, ignoreDirs, ignoreFiles, maxFileSizeBytes, sourcePrefix) {
        // Parse URL to construct the api.github.com endpoint
        const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (!match) {
            throw new Error(`[Security] Invalid GitHub URL format: ${repoUrl}`);
        }
        
        const owner = match[1];
        const repo = match[2].replace(/\.git$/, '');
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/tarball`;

        // Generate secure containment path inside the OS temp directory
        const secureId = crypto.randomBytes(16).toString('hex');
        const tempDirPath = path.join(os.tmpdir(), `sap-builder-${secureId}`);

        // Safety check to prevent malicious path traversal attempts
        this._enforcePathContainment(tempDirPath);

        try {
            await fs.mkdir(tempDirPath, { recursive: true });

            // Configure stateless HTTP headers (injecting the memory token here)
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'SAP-Context-Builder'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            console.log(`[API] Initiating stateless fetch for ${owner}/${repo}...`);
            const response = await fetch(apiUrl, { headers });

            // Strict API Error evaluation
            if (!response.ok) {
                let errorDetails = response.statusText;
                try {
                    const errorJson = await response.json();
                    if (errorJson.message) errorDetails = errorJson.message;
                } catch (e) {} 
                throw new Error(`GitHub API Error (${response.status}): ${errorDetails}`);
            }

            // Stream payload directly to extraction engine (no intermediate tar files saved to disk)
            // strip: 1 removes the dynamic root folder GitHub wraps archives in.
            await pipeline(
                Readable.fromWeb(response.body),
                tar.x({
                    C: tempDirPath, 
                    strip: 1         
                })
            );

            // Read the securely extracted contents
            await this._readDirectory(tempDirPath, tempDirPath, extensions, fileManifest, ignoreDirs, ignoreFiles, maxFileSizeBytes, 0, sourcePrefix, true);

        } catch (error) {
            console.error(`[GitHub Error] Failed to process ${owner}/${repo}:`, error.message);
            throw error;
        } finally {
            // Guaranteed teardown: Always delete the temp folder, even if an error occurs
            await this._safeCleanup(tempDirPath);
        }
    }

    /**
     * Prevents path traversal attacks by ensuring temporary directories remain inside the OS temp vault.
     */
    static _enforcePathContainment(tempDirPath) {
        if (!tempDirPath.startsWith(os.tmpdir())) {
            throw new Error(`[Security] Path traversal attempt detected. Containment breach at: ${tempDirPath}`);
        }
    }

    // =========================================================================
    // LOCAL FILE SYSTEM TRAVERSAL
    // =========================================================================

    /**
     * Recursively reads a directory, validating files against extensions and ignore lists.
     * Includes a "Repo-Discovery check" to ensure we only process valid repository structures.
     */
    static async _readDirectory(basePath, currentPath, allowedExtensions, fileManifest, ignoreDirs, ignoreFiles, maxFileSizeBytes, depth = 0, sourcePrefix = "unknown", isInsideGitRepo = false) {
        const MAX_DEPTH_LIMIT = 15; // Prevent infinite loops or excessively deep structures
        
        // Block scanning the literal root of a drive (e.g., C:\ or /)
        if (currentPath.trim().match(/^([a-zA-Z]:\\|\/)$/)) throw new Error("Root scan prohibited.");
        if (depth > MAX_DEPTH_LIMIT) return;

        try {
            const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });
            
            // --- REPO-DISCOVERY CHECK ---
            // If we aren't already known to be inside a valid repo, check if a .git folder exists here
            let currentlyValidRepo = isInsideGitRepo;
            if (!isInsideGitRepo) {
                currentlyValidRepo = directoryEntries.some(e => e.isDirectory() && e.name === '.git');
                
                // If found, "unlock" the traversal and set the sourcePrefix to this root folder name
                if (currentlyValidRepo) {
                    sourcePrefix = path.basename(currentPath);
                }
            }

            for (const entry of directoryEntries) {
                const lowerName = entry.name.toLowerCase();
                const fullPath = path.join(currentPath, entry.name);

                // Skip symlinks (to prevent cyclical loops) and hidden folders (except .git)
                if (entry.isSymbolicLink()) continue;
                if ((lowerName.startsWith('.') && lowerName !== '.git') || ignoreDirs.includes(lowerName)) continue;

                if (entry.isDirectory()) {
                    // Recurse deeper - passing the "unlocked" status down to children
                    await this._readDirectory(basePath, fullPath, allowedExtensions, fileManifest, ignoreDirs, ignoreFiles, maxFileSizeBytes, depth + 1, sourcePrefix, currentlyValidRepo);
                } 
                else if (entry.isFile() && currentlyValidRepo) {
                    // Only process files if we have confirmed we are inside a valid repository
                    await this._processFile(entry, fullPath, currentPath, allowedExtensions, fileManifest, ignoreFiles, maxFileSizeBytes, sourcePrefix);
                }
            }
        } catch (error) {
            console.error(`[Packer Error] Failed reading path ${currentPath}`);
        }
    }

    /**
     * Validates file size, extracts text content, applies XML normalization, and adds to the manifest.
     */
    static async _processFile(entry, fullPath, basePath, allowedExtensions, fileManifest, ignoreFiles, maxFileSizeBytes, sourcePrefix) {
        const lowerCaseName = entry.name.toLowerCase();
        
        // Guard: Hardcoded blocks for sensitive files (never pack secrets)
        const hardcodedBlocks = ['.env', 'id_rsa', '.pem', '.keystore', 'secrets.json', 'credentials.xml'];
        if (ignoreFiles.includes(entry.name) || hardcodedBlocks.includes(lowerCaseName)) {
            return;
        }

        // Check if file extension is whitelisted
        const hasValidExtension = allowedExtensions.some(ext => entry.name.endsWith(ext));
        if (!hasValidExtension) return;

        // Guard: Enforce max file size to prevent Node.js heap exhaustion
        const fileStats = await fs.stat(fullPath);
        if (fileStats.size > maxFileSizeBytes) {
            console.warn(`[Packer Warning] Skipping ${entry.name} - Exceeds size limit (${fileStats.size} bytes)`);
            return; 
        }

        let fileContent = await fs.readFile(fullPath, 'utf8');
        
        // Compression & Normalization: Standardize line endings and escape conflicting XML CDATA tags
        fileContent = fileContent.replace(/\r\n/g, '\n');
        fileContent = fileContent.replace(/\]\]>/g, ']]]]><![CDATA[>');

        // Namespace the relative path (e.g., /MyProject/src/app.js) to prevent collisions across different repos
        let relativeFilePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
        if (!relativeFilePath.startsWith('/')) relativeFilePath = '/' + relativeFilePath;
        let namespacedPath = `/${sourcePrefix}${relativeFilePath}`.replace(/\/\//g, '/');

        // Append to the global manifest
        fileManifest.push({ path: namespacedPath, content: fileContent });
    }

    // =========================================================================
    // CONTEXT COMPILATION & CHUNKING
    // =========================================================================

    /**
     * Generates a visual structural blueprint (tree map) of the aggregated repositories.
     */
    static _generateProjectBlueprint(fileManifest) {
        if (fileManifest.length === 0) return "No files packed.";
        
        let tree = "Aggregated Project Structure:\n";
        fileManifest.forEach(fileObj => {
            tree += `├── ${fileObj.path}\n`;
        });
        return tree;
    }

    /**
     * Segments the aggregated codebase into XML payloads optimized for LLM token limits.
     * Ensures no single chunk exceeds the maxChars limit.
     */
    static _chunkPayload(fileManifest, aiPrompt, maxChars) {
        const outputChunks = [];
        
        // Securely format the system instructions
        const safePrompt = (aiPrompt || "").replace(/\]\]>/g, ']]]]><![CDATA[>');
        const masterSystemPrompt = `<system_instructions>\n<![CDATA[\n${safePrompt}\n]]>\n</system_instructions>\n\n`;
        
        // Calculate remaining capacity for the first chunk
        const availableChunkCapacity = maxChars - masterSystemPrompt.length - 150; 
        if (availableChunkCapacity <= 1000) {
            throw new Error("Your Master AI Prompt is too large for the configured maxCharsPerChunk threshold.");
        }
        
        let activeChunkXML = "";
        let activeChunkLength = 0;

        for (const fileObj of fileManifest) {
            // Calculate overhead of the XML wrappers
            const fileWrapperOverhead = `\n<file path="${fileObj.path}">\n<![CDATA[\n\n]]>\n</file>\n`.length;
            const totalFileFootprint = fileWrapperOverhead + fileObj.content.length;

            // Scenario 1: A single file is larger than a whole chunk. Must split the file itself.
            if (totalFileFootprint > availableChunkCapacity) {
                // Push whatever is currently built up
                if (activeChunkXML) {
                    outputChunks.push(activeChunkXML);
                    activeChunkXML = "";
                    activeChunkLength = 0;
                }

                let remainingFileContent = fileObj.content;
                let fragmentIndex = 1;

                // Slice the massive file into parts
                while (remainingFileContent.length > 0) {
                    const availableSpaceForFragment = availableChunkCapacity - fileWrapperOverhead - 25; 
                    const dataFragment = remainingFileContent.substring(0, availableSpaceForFragment);
                    
                    outputChunks.push(`\n<file path="${fileObj.path}" part="${fragmentIndex}">\n<![CDATA[\n${dataFragment}\n]]>\n</file>\n`);
                    
                    remainingFileContent = remainingFileContent.substring(availableSpaceForFragment);
                    fragmentIndex++;
                }
                continue; // Move to next file
            }

            // Scenario 2: Adding this file exceeds the current chunk. Close chunk and start a new one.
            if (activeChunkLength + totalFileFootprint > availableChunkCapacity) {
                outputChunks.push(activeChunkXML);
                activeChunkXML = "";
                activeChunkLength = 0;
            }

            // Scenario 3: File fits comfortably. Append to current chunk.
            activeChunkXML += `\n<file path="${fileObj.path}">\n<![CDATA[\n${fileObj.content}\n]]>\n</file>\n`;
            activeChunkLength += totalFileFootprint;
        }

        // Push any remaining data in the active chunk
        if (activeChunkXML) {
            outputChunks.push(activeChunkXML);
        }

        const totalChunks = outputChunks.length;
        
        // Wrap all chunks in <context_chunk> tags and prepend the Master Prompt to the first chunk
        return outputChunks.map((chunkContent, index) => {
            const isFirstChunk = index === 0;
            const prependedPrompt = isFirstChunk ? masterSystemPrompt : "";
            
            return `${prependedPrompt}<context_chunk current="${index + 1}" total="${totalChunks}">\n${chunkContent}</context_chunk>`;
        });
    }

    // =========================================================================
    // SECURITY TEARDOWN
    // =========================================================================

    /**
     * Validates directory integrity and containment before obliteration.
     * Ensures we don't accidentally delete system files if a path gets mangled.
     */
    static async _safeCleanup(targetDirectory) {
        try {
            // Guard 1: Prohibit null or root path targeting
            if (!targetDirectory || targetDirectory === os.tmpdir() || targetDirectory === '/' || targetDirectory === 'C:\\') {
                console.error(`[Security Critical] Refusing to delete protected or root path: ${targetDirectory}`);
                return;
            }

            // Guard 2: Enforce OS Temp Vault containment
            if (!targetDirectory.startsWith(os.tmpdir())) {
                console.error(`[Security Critical] Target directory is outside OS temp vault boundaries: ${targetDirectory}`);
                return;
            }

            // Guard 3: Validate application-specific nomenclature (must be our generated folder)
            const targetBaseName = path.basename(targetDirectory);
            if (!targetBaseName.startsWith('sap-builder-')) {
                 console.error(`[Security Critical] Target lacks secure application prefix: ${targetDirectory}`);
                 return;
            }

            // Guard 4: Existential and Directory Type verification
            try {
                const directoryStats = await fs.stat(targetDirectory);
                if (!directoryStats.isDirectory()) return; 
            } catch (error) {
                return; // Target already deleted or missing
            }

            // Final Execution: Complete unlinked deletion
            await fs.rm(targetDirectory, { recursive: true, force: true });
            console.log(`[Cleanup] Successfully deleted temp vault: ${targetDirectory}`); 

        } catch (cleanupError) {
            console.error(`[Cleanup Error] Could not safely remove temporary directory ${targetDirectory}:`, cleanupError.message);
        }
    }
}

module.exports = ContextPacker;