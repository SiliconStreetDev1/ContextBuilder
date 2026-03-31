/**
 * ContextStudioController
 * Main Orchestrator for the SAP Context Builder Frontend.
 * Handles UI state, profile persistence (LocalStorage), session security (SessionStorage),
 * and communication with the Node.js backend.
 */
class ContextStudioController {
    constructor() {
        // --- State Management ---
        this.currentMemoryChunks = []; // Stores the compiled XML chunks returned from the server
        this.config = null;            // Holds global configuration (ignore lists, extensions)
        this.defaultPrompt = "";       // Stores the system instruction template

        // --- Persistence & Session ---
        // Retrieve the volatile token if one was set in this browser session
        this.sessionToken = sessionStorage.getItem('sap-volatile-token') || null;
        
        // Retrieve the last used profile name or default to "Default Profile"
        this.activeProfileName = localStorage.getItem('sap-active-profile') || "Default Profile";
        
        // Load saved profiles from LocalStorage
        const savedProfiles = localStorage.getItem('sap-context-builder-profiles');
        this.variants = savedProfiles ? JSON.parse(savedProfiles) : {};

        // --- Initialization ---
        this.initToastContainer(); // Setup the notification UI
        this.init();               // Run async startup sequence
    }

    /**
     * Creates a fixed container in the DOM to host toast notifications.
     */
    initToastContainer() {
        this.toastContainer = document.createElement('div');
        this.toastContainer.id = 'toast-container';
        Object.assign(this.toastContainer.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            zIndex: '9999'
        });
        document.body.appendChild(this.toastContainer);
    }

    /**
     * Displays a temporary notification message to the user.
     * @param {string} message - The text to display.
     * @param {string} type - 'info', 'success', or 'error'.
     */
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        
        // Base styling for the toast element
        Object.assign(toast.style, {
            minWidth: '250px',
            padding: '12px 20px',
            borderRadius: '4px',
            color: '#fff',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            opacity: '0',
            transform: 'translateY(20px)',
            transition: 'all 0.3s ease-in-out',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
        });

        // Color coding based on message type
        if (type === 'success') toast.style.backgroundColor = '#2e7d32'; 
        else if (type === 'error') toast.style.backgroundColor = '#d32f2f'; 
        else toast.style.backgroundColor = '#1976d2'; 

        toast.innerText = message;
        this.toastContainer.appendChild(toast);

        // Trigger entrance animation
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        // Exit and cleanup after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Captures the PAT from the UI and stores it in SessionStorage.
     * This token is NOT persisted to disk and dies when the tab is closed.
     */
    setSessionToken() {
        const tokenInput = document.getElementById('globalPatInput');
        if (!tokenInput || !tokenInput.value.trim()) {
            this.showToast("Please enter a valid token first.", "error");
            return;
        }

        this.sessionToken = tokenInput.value.trim();
        sessionStorage.setItem('sap-volatile-token', this.sessionToken);
        
        tokenInput.value = ''; // Clear input for security
        document.getElementById('sessionTokenStatus').style.display = 'block'; // Show "active" indicator
        
        this.showToast("Session token active.", "success");
    }

    /**
     * Fetches the default AI prompt template from the server.
     */
    async fetchDefaultPrompt() {
        try {
            const res = await fetch('/api/prompt');
            if (res.ok) {
                this.defaultPrompt = await res.text();
            } else {
                this.defaultPrompt = "";
            }
        } catch (e) {
            this.defaultPrompt = "";
        }
    }

    /**
     * Main startup sequence. Orchestrates fetching remote data and setting up the UI.
     */
    async init() {
        this.showToast("Initializing...", "info");
        
        await this.fetchDefaultPrompt();
        await this.fetchConfig(); 
        
        // If no profiles exist, create the initial Default Profile
        if (Object.keys(this.variants).length === 0) {
            const defaultExtensions = [];
            
            // Extract default file extensions from the config JSON
            if (this.config && this.config.uiExtensionGroups) {
                this.config.uiExtensionGroups.forEach(group => {
                    group.items.forEach(item => {
                        if (item.default) {
                            defaultExtensions.push(...item.value.split(','));
                        }
                    });
                });
            }

            this.variants["Default Profile"] = {
                sources: [{type: 'local', path: ''}], 
                prompt: this.defaultPrompt, 
                extensions: defaultExtensions 
            };
        }
        
        // Safety check for active profile existence
        if (!this.variants[this.activeProfileName]) {
            this.activeProfileName = Object.keys(this.variants)[0] || "Default Profile";
        }
        
        this.refreshVariantList(); // Sync dropdown with profile keys
        this.loadVariant();        // Populate UI with active profile data

        // Show session indicator if a token already exists in SessionStorage
        if (this.sessionToken) {
            document.getElementById('sessionTokenStatus').style.display = 'block';
        }
    }

    /**
     * Fetches global configuration and dynamically builds the Extension UI grid.
     */
    async fetchConfig() {
        try {
            const res = await fetch('/api/config');
            this.config = await res.json();
            
            const extContainer = document.getElementById('extGroup');
            if (extContainer) {
                extContainer.innerHTML = ''; 
                // Iterate through config groups (ABAP, Web, Core, etc.)
                this.config.uiExtensionGroups.forEach(group => {
                    const header = document.createElement('h4');
                    header.innerText = group.groupName;
                    extContainer.appendChild(header);

                    group.items.forEach(item => {
                        const lbl = document.createElement('label');
                        lbl.innerHTML = `<input type="checkbox" value="${item.value}" ${item.default ? 'checked' : ''}> ${item.label}`;
                        extContainer.appendChild(lbl);
                    });
                });
            }
        } catch (e) {
            this.showToast("Failed to load configuration.", "error");
        }
    }

    /**
     * Dynamically adds a new source row (Local path or GitHub URL) to the UI.
     * @param {string} sourceType - 'local' or 'github'.
     * @param {string} sourcePath - The file path or repo URL.
     */
    addSourceRow(sourceType, sourcePath) {
        const container = document.getElementById('sourcesContainer');
        if (!container) return;

        const rowDiv = document.createElement('div');
        rowDiv.className = 'source-row';
        rowDiv.dataset.type = sourceType;
        
        rowDiv.innerHTML = `
            <div style="flex:1; display:flex; gap:8px;">
                <select class="src-type">
                    <option value="local" ${sourceType === 'local' ? 'selected' : ''}>Local</option>
                    <option value="github" ${sourceType === 'github' ? 'selected' : ''}>GitHub</option>
                </select>
                <input type="text" class="primary-input" value="${sourcePath}" placeholder="Path/URL...">
            </div>
            <button class="danger" onclick="this.closest('.source-row').remove(); App.checkGitHubUI();">X</button>
        `;

        // Update row metadata and check UI visibility on type change
        rowDiv.querySelector('.src-type').addEventListener('change', (e) => {
            rowDiv.dataset.type = e.target.value;
            this.checkGitHubUI();
        });

        container.appendChild(rowDiv);
        this.checkGitHubUI();
    }

    /**
     * Shows/Hides the GitHub Authentication section based on whether GitHub sources are present.
     */
    checkGitHubUI() {
        const authSection = document.getElementById('githubAuthSection');
        if (!authSection) return;

        const hasGithub = Array.from(document.querySelectorAll('.source-row')).some(row => row.dataset.type === 'github');
        authSection.style.display = hasGithub ? 'block' : 'none';
    }

    /**
     * Gathers all UI state and sends it to the backend to compile the context XML.
     */
    async compileContext() {
        // Collect and filter valid sources
        const sources = Array.from(document.querySelectorAll('.source-row')).map(row => ({
            type: row.dataset.type, 
            path: row.querySelector('.primary-input').value
        })).filter(src => src.path.trim() !== "");
        
        if (!sources.length) {
            this.showToast("Please add at least one source.", "error");
            return;
        }
        
        // Collect checked extensions
        const extensions = Array.from(document.querySelectorAll('#extGroup input:checked'))
            .flatMap(el => el.value.split(','));

        const packBtn = document.getElementById('packBtn');
        if (packBtn) packBtn.disabled = true; // Prevent double submission
        
        this.showToast("Compiling context...", "info");

        try {
            const aiPromptElement = document.getElementById('aiPrompt');
            const res = await fetch('/api/pack', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    sources, 
                    extensions, 
                    aiPrompt: aiPromptElement ? aiPromptElement.value : '',
                    sessionToken: this.sessionToken 
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Compilation failed");

            // Update state with chunks and refresh UI
            this.currentMemoryChunks = data.chunks;
            this.renderChunksToUI();
            
            this.showToast("Context successfully compiled.", "success");
            
        } catch (error) { 
            this.showToast(`Error: ${error.message}`, "error"); 
        } finally { 
            if (packBtn) packBtn.disabled = false; 
        }
    }

    /**
     * Renders the compiled chunks as interactive cards in the UI.
     */
    renderChunksToUI() {
        const container = document.getElementById('chunks-display');
        if (!container) return;
        
        container.innerHTML = "";
        this.currentMemoryChunks.forEach((chunk, index) => {
            const card = document.createElement('div');
            card.className = 'chunk-card';
            card.innerHTML = `
                <div class="chunk-header">
                    <span class="chunk-title">CHUNK ${index + 1}</span>
                    <button class="secondary" style="width:auto; padding:4px 10px;" onclick="App.copyChunk(this, ${index})">COPY</button>
                </div>
                <div class="chunk-body">${chunk.substring(0, 300).replace(/</g, '&lt;')}...</div>
            `;
            container.appendChild(card);
        });
    }

    /**
     * Copies a specific chunk's content to the system clipboard.
     * @param {HTMLElement} btn - The button element clicked.
     * @param {number} idx - Index of the chunk in the state array.
     */
    copyChunk(btn, idx) { 
        navigator.clipboard.writeText(this.currentMemoryChunks[idx])
            .then(() => {
                const orig = btn.innerText; 
                btn.innerText = "COPIED!"; 
                this.showToast(`Chunk ${idx + 1} copied to clipboard`, "success");
                setTimeout(() => btn.innerText = orig, 2000); 
            })
            .catch(() => this.showToast("Failed to copy", "error"));
    }

    /**
     * Rebuilds the Profile selection dropdown.
     */
    refreshVariantList() {
        const select = document.getElementById('variantSelect');
        if (!select) return;

        select.innerHTML = Object.keys(this.variants)
            .map(key => `<option value="${key}">${key}</option>`).join('');
        select.value = this.activeProfileName;
    }

    /**
     * Loads the data from a selected profile into the UI inputs.
     */
    loadVariant() { 
        const select = document.getElementById('variantSelect');
        if (!select) return;

        const selected = select.value;
        const data = this.variants[selected];
        if (!data) return;
        
        this.activeProfileName = selected;
        localStorage.setItem('sap-active-profile', selected);
        
        // Repopulate Sources
        const sourcesContainer = document.getElementById('sourcesContainer');
        if (sourcesContainer) {
            sourcesContainer.innerHTML = ''; 
            data.sources.forEach(src => this.addSourceRow(src.type, src.path)); 
        }
        
        // Repopulate Prompt
        const aiPrompt = document.getElementById('aiPrompt');
        if (aiPrompt) {
            aiPrompt.value = data.prompt || this.defaultPrompt || ''; 
        }
        
        // Update Extension Checkboxes
        const checks = document.querySelectorAll('#extGroup input');
        checks.forEach(chk => {
            chk.checked = data.extensions.some(e => chk.value.includes(e));
        });
    }

    /**
     * Saves the current UI state to the currently active profile.
     */
    saveVariant() { 
        const name = this.activeProfileName;
        this._persistProfile(name);
        this.showToast(`Profile "${name}" saved.`, "success");
    }

    /**
     * Creates a new profile based on current UI state.
     */
    saveAsVariant() {
        const name = prompt("Enter new profile name:");
        if (!name || name.trim() === "") {
            this.showToast("Save cancelled: Name cannot be empty.", "info");
            return;
        }
        
        const cleanName = name.trim();
        this._persistProfile(cleanName);
        this.activeProfileName = cleanName;
        localStorage.setItem('sap-active-profile', this.activeProfileName);
        
        this.refreshVariantList();
        this.showToast(`New profile "${cleanName}" saved.`, "success");
    }

    /**
     * Deletes the currently active profile.
     */
    deleteVariant() {
        const name = this.activeProfileName;

        // Protection for the mandatory Default Profile
        if (name === "Default Profile") {
            this.showToast("The Default Profile cannot be deleted.", "error");
            return;
        }

        if (!confirm(`Delete profile "${name}"?`)) {
            return;
        }

        delete this.variants[name];
        localStorage.setItem('sap-context-builder-profiles', JSON.stringify(this.variants));

        // Fall back to Default Profile
        this.activeProfileName = "Default Profile";
        localStorage.setItem('sap-active-profile', this.activeProfileName);

        this.refreshVariantList();
        this.loadVariant();
        this.showToast(`Profile deleted.`, "success");
    }

    /**
     * Internal helper to serialize UI state and save it to LocalStorage.
     * @param {string} name - The name of the profile to save.
     */
    _persistProfile(name) {
        const aiPrompt = document.getElementById('aiPrompt');
        this.variants[name] = { 
            sources: Array.from(document.querySelectorAll('.source-row')).map(row => ({
                type: row.dataset.type, 
                path: row.querySelector('.primary-input').value
            })), 
            prompt: aiPrompt ? aiPrompt.value : '', 
            extensions: Array.from(document.querySelectorAll('#extGroup input:checked')).flatMap(el => el.value.split(','))
        }; 
        localStorage.setItem('sap-context-builder-profiles', JSON.stringify(this.variants)); 
    }

    /**
     * Aggregates all chunks and triggers a file download of the full XML.
     */
    downloadAll() {
        if (!this.currentMemoryChunks || this.currentMemoryChunks.length === 0) {
            this.showToast("Nothing to download.", "error");
            return;
        }
        
        // Wrap chunks in XML root tags
        const payload = '<?xml version="1.0" encoding="UTF-8"?>\n<sap_context_dump>\n' + this.currentMemoryChunks.join('\n') + '\n</sap_context_dump>';
        const blob = new Blob([payload], { type: 'application/xml' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'sap_context_build.xml';
        link.click();
        
        this.showToast("Download started.", "success");
    }
}

// Global entry point
window.App = new ContextStudioController();