# 🤖 AI-Powered Frontend Website Cloning Agent

> Analyze a public website and recreate it as a responsive Next.js frontend, then refine it with natural-language instructions.

![AI Website Cloner](https://img.shields.io/badge/AI-Local_Qwen2.5--VL-6366f1?style=for-the-badge)
![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge)
![Playwright](https://img.shields.io/badge/Playwright-1.40-green?style=for-the-badge)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🌐 **Intelligent Scraping** | Playwright captures full-page screenshots, DOM structure, computed CSS, fonts, and color palettes |
| 🔬 **Website Analysis** | Uses a local vision-capable model plus extracted page structure, styles, and content to understand the design |
| ⚡ **Next.js Code Generation** | Generates responsive TypeScript React components and reuses relevant image assets from the source site |
| 🧠 **Natural Language Mods** | Modify generated sites using plain English: *"Change primary color to blue"* |
| 🔨 **Auto Error Fixing** | Detects TypeScript/React build errors and auto-fixes them with AI |
| 🚀 **Instant Preview** | Dev server starts automatically with hot-reload |
| 💻 **Code Viewer** | Browse and inspect all generated files in the UI |
| 📡 **Real-time Streaming** | SSE-powered live log streaming during generation |

---

## 🏗️ Architecture

```
User Input (URL)
     ↓
[Agent Backend - Express + TypeScript]
     │
     ├─► [Scraper] → Playwright captures screenshot, DOM, CSS, assets
     │
     ├─► [Analyzer] → Local Qwen2.5-VL analyzes layout, colors, and sections
     │
     ├─► [Generator] → Local model generates Next.js components per section
     │
     ├─► [Builder] → npm install + next dev + error detection/auto-fix
     │
     └─► [Modifier] → Natural language → targeted code patches
          ↑
[UI - Next.js App]
  - Public website URL input
  - Real-time logs (SSE)
  - Stage pipeline indicator
  - Color palette from analysis
  - Code file viewer
  - Embedded iframe preview
  - AI modification panel with quick actions
```

## 📁 Project Structure

```
soulStarr/
├── agent/                    # AI Agent Backend
│   ├── src/
│   │   ├── scraper/         # Playwright web scraper
│   │   │   └── index.ts     # Extracts DOM, styles, colors, fonts
│   │   ├── analyzer/        # Local vision-model analyzer
│   │   │   └── index.ts     # Structured website analysis
│   │   ├── generator/       # Next.js code generator
│   │   │   └── index.ts     # Component + page generation
│   │   ├── builder/         # Dev server manager
│   │   │   └── index.ts     # npm install + next dev
│   │   ├── modifier/        # NL code modifier
│   │   │   └── index.ts     # AI-powered code patches
│   │   └── server.ts        # Express API + SSE
│   ├── .env                 # Optional Ollama configuration
│   └── package.json
│
├── ui/                       # Control Panel UI (Next.js)
│   ├── app/
│   │   ├── page.tsx         # Main UI
│   │   ├── page.module.css  # Premium dark design
│   │   ├── globals.css      # Design system
│   │   └── layout.tsx
│   └── package.json
│
├── generated/                # Output: cloned Next.js projects
│   └── clone-{jobId}/       # One folder per cloned site
│
├── start.bat                 # 🚀 One-click startup (Windows)
└── README.md
```

---

## 🚀 Quick Start

### 1. Prerequisites

- **Node.js** v18+
- **Ollama** with the `qwen2.5vl:3b` model available
- **Playwright Chromium** (installed in step 2)

### 2. Install Dependencies

```bash
# Install agent dependencies
cd agent
npm install
npx playwright install chromium

# Install UI dependencies
cd ../ui
npm install
```

### 3. Start Ollama

Start Ollama and pull the default model:
```bash
ollama pull qwen2.5vl:3b
```

The model can be changed with `OLLAMA_VL_MODEL`; the Ollama endpoint can be changed with `OLLAMA_BASE_URL` in `agent/.env`. No cloud API key is required.

### 4. Start the Application

**Option A: One-click (Windows)**
```
Double-click start.bat
```

**Option B: Manual**
```bash
# Terminal 1 - Agent Backend
cd agent && npm run dev

# Terminal 2 - UI
cd ui && npm run dev
```

Open http://localhost:3000

---

## 🎮 Usage

### Clone a Website
1. Paste a public website URL (e.g., `https://stripe.com`)
2. Click **⚡ Clone It**
3. Watch real-time scraping, analysis, generation, and build progress
4. Preview the generated frontend when the build completes

### AI Modifications
After cloning, use the modification panel:
- **Quick actions**: Click any pre-built prompt
- **Custom**: Type any natural language instruction

Examples:
```
"Change the primary color to emerald green"
"Make the navbar sticky with backdrop blur"
"Add a dark mode toggle"
"Replace the hero with a SaaS hero"
"Add a features grid with icons"
"Remove the pricing section"
```

---

## 🔌 API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Agent health check |
| `/api/clone` | POST | Start a clone job |
| `/api/status/:jobId` | GET | Get job status |
| `/api/status/:jobId/stream` | GET | SSE stream (real-time logs) |
| `/api/modify` | POST | Apply NL modification |
| `/api/files/:jobId` | GET | List generated files |
| `/api/files/:jobId/content` | GET | Get file content |
| `/api/jobs` | GET | List all jobs |

---

## 🧪 Tested With

- https://stripe.com — Payment platform
- https://linear.app — Project management  
- https://vercel.com — Hosting platform
- https://notion.so — Productivity app
- https://openai.com — AI company
- https://tailwindcss.com — CSS framework

---

## 🖥️ AI Runtime

Analysis, generation, repair, and natural-language modifications use the configured local Ollama model. Clone time and resource use depend on the model, GPU/CPU, and the number of detected page sections. Website scraping and generated-project dependency installation require network access.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent Backend | Node.js + TypeScript + Express |
| Scraping | Playwright (Chromium) |
| AI | Local Ollama model (default: Qwen2.5-VL 3B) |
| Generated Frontend | Next.js 14 + TypeScript |
| UI | Next.js 14 + CSS Modules |
| Streaming | Server-Sent Events (SSE) |
| Process Mgmt | tree-kill + child_process |

---

## 📄 License

MIT — Built as an AI engineering assignment.
