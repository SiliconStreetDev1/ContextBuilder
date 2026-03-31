> <small>⚠️ **Notice for Existing Users (March 2026 Update)**
> 
> <small>To improve maintainability, the underlying Git history of this repository was recently streamlined. If you downloaded ContextBuilder before **March 31, 2026**, a standard `git pull` will fail. Please use one of the two methods below to sync to the latest version.</small>
>
> <small>**Option 1: The Easy Way (Recommended)**</small><br>
> <small>Delete your existing folder and re-download: `git clone https://github.com/SiliconStreetDev1/ContextBuilder.git`</small>
>
> <small>**Option 2: The Terminal Way**</small><br>
> <small>Inside your project directory, run: `git fetch origin` followed by `git reset --hard origin/main`</small><br><br>
> <small>💡 **Important Setup Change:** Token storage is now strictly managed via `.env` variables. Please review the **Credential Management & Responsibility** section below to configure your new setup.</small>


# SAP Context Builder For LLM

A desktop only (Not for server usage)  tool for SAP teams that assembles multiple ABAP, UI5 and utility repositories into clean XML bundles and chunked context packs for web‑ and IDE‑based LLMs. It gives Gemini, ChatGPT, and Claude a unified, cross‑repo view of your entire landscape so they can generate precise, standard‑compliant ABAP, UI5, and other code with full architectural awareness.

> ⚠️ The generated Chunks and XML files contain the actual source code extracted from your configured repositories.


---

A desktop only (Not for server usage)  tool for SAP teams that assembles multiple ABAP, UI5 and utility repositories into clean XML bundles and chunked context packs for web‑ and IDE‑based LLMs. It gives Gemini, ChatGPT, and Claude a unified, cross‑repo view of your entire landscape so they can generate precise, standard‑compliant ABAP, UI5, and other code with full architectural awareness.

> ⚠️ The generated Chunks and XML files contain the actual source code extracted from your configured repositories.


---

## Why Create Context?

Large Language Models (LLMs) operate within strict token limits and have no inherent visibility into your specific SAP environment. Feeding an LLM a single isolated file often results in code that references non-existent variables, hallucinates method calls, or breaks architectural patterns.

Creating a compressed context payload solves this:

- **Improves Hit Rate:** By stripping whitespace, removing carriage returns, and excluding irrelevant frontend/build directories, you maximize the amount of relevant codebase (Data Dictionary, Global Classes, CDS views) that fits into a single prompt.
- **Reduces Hallucinations:** Providing the broader project architecture allows the LLM to read existing definitions rather than guessing them.
- **Enforces Standards:** Packaging system instructions alongside the raw code attempts to force the LLM to adhere to strict rules before it generates a response.
- **Read-Only by Design:** The SAP Context Builder only reads your repository files to generate the XML output.

## 🔒 Intended Local Access & Security

This application is configured with a **Local Access Only** design intended to mitigate the exposure of project data and GitHub tokens. 

### Connection Handling
The default configuration is **designed to ignore** requests from external network IPs (e.g., `192.168.x.x`). Users should only attempt to access the tool via the local loopback address:

| Method | URL | Expected Outcome |
| :--- | :--- | :--- |
| **Localhost** | `http://localhost:3000` | Intended to connect |
| **Loopback IP** | `http://127.0.0.1:3000` | Intended to connect |
| **Network IP** | `http://192.168.x.x:3000` | Expected to be refused |

---

## Quick Start

1. Clone or download this repository.
2. Install dependencies by running: `npm install`
3. Start the local server by running: `npm start`
4. Navigate to `http://localhost:3000` in your web browser. 
5. Add Git Repo Url or Local Path.
6. Click **📦 1. COMPILE FULL CONTEXT**.
7. Click **Download XML**.
8. Open your preferred Web LLM (Gemini, ChatGPT, Claude).
9. Paste the XML File or Chunks into the chat interface.
10. Wait for Acknowledgement.
11. Start Querying and Coding.


> ⚠️ **CRITICAL SECURITY WARNING regarding GitHub PATs**
> All token securing and management is the user's responsibility where possible use Read Only Tokens.

> ⚠️ **IMPORTANT: USER RESPONSIBILITY**
> The use of this software and any resulting AI-generated logic is strictly subject to the [Legal Disclaimer & Limitation of Liability](./LEGAL.md). Users are responsible for validating all code before introduction to any SAP environment.

---

## 🔐 Privacy & Data Handling

Since this tool involves sending your codebase to external LLMs, you should be mindful of how that data is stored and used for training.

### Recommended Privacy Settings

If you are working with proprietary enterprise code, it is highly recommended to disable activity tracking/training in your LLM's settings:

- **Google Gemini:** Go to [myactivity.google.com](https://myactivity.google.com), find **Gemini Apps Activity**, and toggle it to **Off**. This prevents your prompts and code context from being used to improve Google's models.
- **ChatGPT:** Go to **Settings** > **Data Controls** and disable **Chat History & Training**.
- **Claude:** Anthropic generally does not use Pro/Team/Enterprise data for training by default, but always double-check your specific plan's privacy terms.

**Note:** Disabling these settings is a standard "best practice" for developers using web-based LLMs for professional work. Even with these settings off, always follow your organization's specific AI usage policies.

## ✨ Core Features

- **Multi-Repository Aggregation:** Compile context from multiple local paths and remote GitHub repositories simultaneously. Fully supports both backend ABAP and frontend SAP UI5 / Fiori codebases in a single payload.
- **Maximum Payload Compression:** Removes carriage returns and allows strict directory exclusion to aggressively compress payloads, targeting the highest possible hit rate within LLM token limits.
- **ABAP Standards:** Includes a system prompt instructing the LLM to output clean, modular, and well-commented ABAP, explicitly prohibiting Hungarian notation (e.g., no `LV_` variables).
- **OO Syntax Rules:** Enforces standard multi-line global class definitions (requiring `CLASS zcl_classname DEFINITION PUBLIC FINAL CREATE PUBLIC .`) to prevent syntax errors.
- **Profile Management:** Saves project configurations (sources, extensions, prompts) to Local Storage.
- **Secure GitHub Integration:** Retrieves private repositories using a Personal Access Token (PAT).

### 🌐 Distributed Development Unification

The SAP Context Builder bridges the gap between distributed developments by linking multiple repositories into a single, cohesive AI context.

- **Unified Context Stream:** Aggregate disparate components—such as ABAP backends, UI5 frontends, and shared libraries—into one synchronized XML payload.
- **Multi-Source Ingestion:** Allows you to mix local file system paths and remote GitHub URLs within the same session.
- **Holistic Architecture:** By consolidating separate codebases, the tool provides the AI with a complete architectural view of your entire project landscape, rather than isolated fragments.
- **Seamless Aggregation:** The background engine iterates through every configured source, cloning remote repositories into isolated temporary directories and merging all artifacts into a centralized collection before intelligent chunking.

#### 🌐 REST Service Integration

The system utilizes the GitHub REST API for all remote repository operations.

### 🛰️ Remote Source Orchestration (Git)

The engine utilizes a non-persistent ingestion strategy for remote repositories, designed to minimize data residue on the host system.

* **Cryptographic Isolation:** Repositories are cloned into unique directory structures within the OS temporary vault, identified by a 128-bit hex ID (`sap-builder-[unique-id]`). This is designed to prevent directory collisions and cross-process data leakage.
* **Ephemeral Ingestion:** Utilizing shallow clones (`--depth 1`), the engine extracts only the latest commit state to reduce network overhead and disk footprint.

### 🛡️ Deletion Strategy (Ingestion Cleanup)

> **Note: Exported Files Are Not Deleted**
> The deletion script described below applies **only** to the temporary folders created during the `git clone` background process. The application does not track, manage, or delete the final XML bundles or Chunk data files that you export.

To limit the data footprint on the host environment, the engine utilizes a multi-stage logic that attempts to remove temporary ingestion folders. **Because this process relies on local file system permissions and operating system constraints, successful deletion cannot be guaranteed.**

1.  **Containment Check:** Checks if the target directory is located within the operating system's designated temporary boundaries.
2.  **Nomenclature Validation:** Checks that the folder name matches the specific application prefix (`sap-builder-`).
3.  **Existential Verification:** Checks if the target is a valid directory prior to initiating any removal command.
4.  **Repository Footprint Audit:** Inspects the target for Git metadata to help identify repository system folders.
5.  **Recursive Removal:** Executes a removal command on the temporary allocation after the files have been ingested into the memory buffer.
### Prerequisites

- Node.js (v16 or higher)
- Git (for GitHub repository cloning)

## ⚙️ Configuration (`config.json`)

The `config.json` file in the root directory controls the engine's compilation limits, exclusions, and UI toggles.

### Key Parameters:

- `maxCharsPerChunk`: The mathematical ceiling for each output chunk. Lower this if your target LLM is rejecting the payload size.
- `maxFileSizeBytes`: Skips individual files larger than this limit to prevent memory crashes.
- `ignoreDirs`: **Crucial for hit-rate optimization.** Add the folder names of heavy BSP applications, Fiori `webapp` folders, or node modules here to entirely bypass them during the build process.
- `ignoreFiles`: Specific filenames to skip across all directories.
- `uiExtensionGroups`: Defines the categories and specific file extensions (.clas.abap, .asddls, .xml) available to whitelist in the UI.

## 🔐 Credential Management & Responsibility

Users are responsible for managing their tokens via the following two methods:

### 1. Volatile Session Storage (Web UI)
* **How it works**: Tokens entered in the UI are stored strictly in the browser's `sessionStorage`.
* **Persistence**: The token exists only in the memory of the active browser tab and should be destroyed immediately when the tab is closed.
* **User Responsibility*: While session storage is safer than disk storage, it is still susceptible to local shoulder-surfing or browser-level compromises. Users paste tokens at their own risk.

### 2. Environment Variables (`.env`)
* **How it works**: For local persistence, users may manually create a `.env` file in the project root containing `GITHUB_TOKEN=your_pat`.
* **Safety**:  User must always check that  `.gitignore` is configured to ignore `.env` files. 
* **Liability**: **Users are strictly responsible** for ensuring their `.env` file is never committed to a public repository. It is recommended to use the provided `.env.example` as a template only.

> ### ⚠️ **DISCLAIMER**
> * **User Responsibility**: You are solely responsible for managing your credentials. Use `.env` files or `sessionStorage` and never commit secrets to version control.
> * **Zero Liability**: This tool is provided "as is." The maintainers assume **no responsibility or liability** for any leaked credentials, unauthorized access, or data breaches, regardless of the circumstances or cause.
---

## ⚖️ LEGAL DISCLAIMER & LIMITATION OF LIABILITY

**This tool is provided "as-is" without warranty of any kind.**

The creator assumes **zero liability** for system impacts, disk errors, accidental data loss, or the security, accuracy, and performance of any AI-generated code. Users are solely responsible for reviewing, testing, and validating all code before introducing it to any SAP environment.

Your use of this software, its handling of credentials, and any resulting AI-generated logic are strictly subject to the full terms found here: <br> **[Read the Full Legal Disclaimer & Limitation of Liability](./LEGAL.md)**
