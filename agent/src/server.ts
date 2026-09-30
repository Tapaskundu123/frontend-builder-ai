import express, { Request, Response } from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

import { WebScraper } from './scraper';
import { WebsiteAnalyzer } from './analyzer';
import { CodeGenerator } from './generator';
import { ProjectBuilder, WhatWasBuilt } from './builder';
import { CodeModifier } from './modifier';

dotenv.config();

// Process-level guards — prevent uncaught errors from killing the server
process.on('uncaughtException', (err) => {
  console.error('[Server] ⚠️ Uncaught exception (process kept alive):', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] ⚠️ Unhandled promise rejection (process kept alive):', reason);
});

const app = express();
const PORT = process.env.AGENT_PORT || 3001;
const GENERATED_DIR = path.join(__dirname, '../../generated');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- Job State Management ---
interface Job {
  id: string;
  status: 'pending' | 'scraping' | 'analyzing' | 'generating' | 'building' | 'ready' | 'error';
  url: string;
  logs: string[];
  previewUrl?: string;
  projectPath?: string;
  error?: string;
  analysis?: any;
  whatWasBuilt?: WhatWasBuilt;
  promptQuestion?: string;
  suggestedMods?: string[];
  autoFixCount?: number;
  screenshot?: string;
  clients: Response[];
}

const jobs = new Map<string, Job>();

function sendJobEvent(job: Job, data: object) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  job.clients = job.clients.filter(client => {
    try {
      client.write(message);
      return true;
    } catch {
      return false;
    }
  });
}

function updateJob(job: Job, update: Partial<Job> & { log?: string }) {
  Object.assign(job, update);
  if (update.log) {
    job.logs.push(update.log);
    sendJobEvent(job, { type: 'log', message: update.log, status: job.status });
  }
  if (update.status) {
    sendJobEvent(job, { 
      type: 'status', 
      status: job.status, 
      previewUrl: job.previewUrl,
      whatWasBuilt: job.whatWasBuilt,
      promptQuestion: job.promptQuestion,
      suggestedMods: job.suggestedMods,
    });
  }
}

// --- API Routes ---

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'AI Website Cloner Agent is running' });
});

// Start a clone job
app.post('/api/clone', async (req: Request, res: Response) => {
  const { url } = req.body;

  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'A website URL is required' });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    return res.status(400).json({ error: 'Enter a valid website URL, including https:// or http://' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    return res.status(400).json({ error: 'Only HTTP and HTTPS website URLs are supported' });
  }

  const jobId = uuidv4();
  const job: Job = {
    id: jobId,
    status: 'pending',
    url: parsedUrl.toString(),
    logs: [],
    clients: [],
  };
  jobs.set(jobId, job);

  console.log('[Server] 🤖 Architecture: 100% Single Local Model (Qwen2.5-VL-3B via Ollama on RTX GPU)');

  res.json({ jobId, message: 'Clone job started' });

  // Run pipeline asynchronously with single local model
  runClonePipeline(job).catch(err => {
    updateJob(job, { 
      status: 'error', 
      error: err.message,
      log: `[Error] ${err.message}` 
    });
  });
});

async function runClonePipeline(job: Job): Promise<void> {
  const log = (msg: string) => updateJob(job, { log: msg });

  try {
    // Stage 1: Scrape
    updateJob(job, { status: 'scraping', log: '[Stage 1/4] 🌐 Scraping website & capturing full UI screenshot via Playwright...' });
    const scraper = new WebScraper();
    const scraped = await scraper.scrape(job.url);
    job.screenshot = scraped.screenshot;
    log(`[Stage 1/4] 📸 Scraped "${scraped.title}" - Captured full UI screenshot & detected ${scraped.sections.length} sections`);
    if (scraped.domReduction) {
      log(`[Stage 1/4] 📉 DOM Reduction: ${Math.round(scraped.domReduction.rawHtmlBytes / 1024)} KB raw HTML → ${Math.round(scraped.domReduction.compressedBytes / 1024)} KB AX Layout (${scraped.domReduction.reductionPercentage}% context reduction)`);
    }
    if (scraped.downsampling) {
      log(`[Stage 1/4] 🖼️ Dynamic Resolution Downsampling: Scaled screenshot ${scraped.downsampling.originalWidth}x${scraped.downsampling.originalHeight} → ${scraped.downsampling.downsampledWidth}x${scraped.downsampling.downsampledHeight} (Max width: 1080px) to optimize visual token math.`);
    }
    sendJobEvent(job, { 
      type: 'scraped', 
      hasScreenshot: true, 
      screenshotUrl: `/api/screenshot/${job.id}`,
      domReduction: scraped.domReduction,
      downsampling: scraped.downsampling,
    });

    // Stage 2: Analyze
    updateJob(job, { status: 'analyzing', log: '[Stage 2/4] 🔍 Analyzing design & layout from scraped data (Local Qwen2.5-3B)...' });
    const analyzer = new WebsiteAnalyzer();
    const analysis = await analyzer.analyze(scraped);
    job.analysis = analysis;
    log(`[Stage 2/4] ✅ Analysis complete: ${analysis.siteType} site, ${analysis.sections.length} sections detected`);
    log(`[Stage 2/4] Brand: ${analysis.brandName}, Style: ${analysis.overallStyle}, Colors: ${analysis.primaryColor}`);
    log(`[Stage 2/4] 🤖 Architecture: 100% Single Local Model (Qwen2.5-3B via Ollama - Token-optimized scraped data)`);
    sendJobEvent(job, { type: 'analysis', analysis });

    // Stage 3: Generate
    updateJob(job, { status: 'generating', log: '[Stage 3/4] ⚡ Generating Next.js frontend from structured scraped data...' });
    const generator = new CodeGenerator(GENERATED_DIR);
    const result = await generator.generate(scraped, analysis, job.id, log);
    job.projectPath = result.projectPath;
    log(`[Stage 3/4] ✅ Generated ${result.files.length} project files`);

    // Stage 4: Build & Auto-Repair loop
    updateJob(job, { status: 'building', log: '[Stage 4/4] Installing dependencies & verifying build...' });
    const builder = new ProjectBuilder();
    const buildResult = await builder.installAndRun(
      result.projectPath,
      job.id,
      '',
      log,
      { brandName: analysis.brandName, siteType: analysis.siteType }
    );

    if (buildResult.success) {
      job.whatWasBuilt = buildResult.whatWasBuilt;
      job.autoFixCount = buildResult.autoFixCount;

      const promptQuestion = `🎉 Your site is live and fully functional at ${buildResult.url}! Is there anything you'd like to change or customize?`;
      const suggestedMods = [
        `Make header navigation sticky with backdrop blur`,
        `Change color palette to modern emerald and dark theme`,
        `Add a testimonials & client reviews section`,
        `Add interactive cards with hover animations`,
        `Add a newsletter subscription section in footer`,
      ];

      job.promptQuestion = promptQuestion;
      job.suggestedMods = suggestedMods;

      if (buildResult.autoFixCount && buildResult.autoFixCount > 0) {
        log(`[Auto-Fix] 🛡️ AI automatically resolved ${buildResult.autoFixCount} build error(s) during verification!`);
      }
      log(`[Stage 4/4] ✅ Fully functional build live at ${buildResult.url}`);
      log(`[Agent] 💬 ${promptQuestion}`);

      updateJob(job, {
        status: 'ready',
        previewUrl: buildResult.url,
        whatWasBuilt: buildResult.whatWasBuilt,
        promptQuestion,
        suggestedMods,
      });

      sendJobEvent(job, {
        type: 'ready',
        previewUrl: buildResult.url,
        jobId: job.id,
        whatWasBuilt: buildResult.whatWasBuilt,
        autoFixCount: buildResult.autoFixCount,
        promptQuestion,
        suggestedMods,
        screenshotUrl: job.screenshot ? `/api/screenshot/${job.id}` : undefined,
      });
    } else {
      updateJob(job, { 
        status: 'error', 
        error: buildResult.errors.join('\n'),
        log: `[Error] Could not resolve build errors: ${buildResult.errors.join('; ')}` 
      });
      sendJobEvent(job, { type: 'error', error: buildResult.errors.join('\n') });
    }
  } catch (err: any) {
    throw err;
  }
}

// SSE endpoint for real-time logs
app.get('/api/status/:jobId/stream', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send all existing logs
  job.logs.forEach(log => {
    res.write(`data: ${JSON.stringify({ type: 'log', message: log, status: job.status })}\n\n`);
  });

  // Send current status and metadata
  res.write(`data: ${JSON.stringify({ 
    type: 'status', 
    status: job.status, 
    previewUrl: job.previewUrl,
    whatWasBuilt: job.whatWasBuilt,
    promptQuestion: job.promptQuestion,
    suggestedMods: job.suggestedMods,
    autoFixCount: job.autoFixCount,
    screenshotUrl: job.screenshot ? `/api/screenshot/${job.id}` : undefined,
  })}\n\n`);

  if (job.status === 'error') {
    res.end();
    return;
  }

  // Keep connection open so modifications and live updates stream
  job.clients.push(res);

  req.on('close', () => {
    job.clients = job.clients.filter(c => c !== res);
  });
});

// Get job status
app.get('/api/status/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    id: job.id,
    status: job.status,
    url: job.url,
    logs: job.logs,
    previewUrl: job.previewUrl,
    error: job.error,
    analysis: job.analysis,
    whatWasBuilt: job.whatWasBuilt,
    promptQuestion: job.promptQuestion,
    suggestedMods: job.suggestedMods,
    autoFixCount: job.autoFixCount,
    screenshotUrl: job.screenshot ? `/api/screenshot/${job.id}` : undefined,
  });
});

// Serve captured website screenshot
app.get('/api/screenshot/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job || !job.screenshot) {
    return res.status(404).json({ error: 'Screenshot not found for this job' });
  }

  const buffer = Buffer.from(job.screenshot, 'base64');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
});

// Apply natural-language modification
app.post('/api/modify', async (req: Request, res: Response) => {
  const { jobId, instruction, apiKey } = req.body;

  if (!jobId || !instruction) {
    return res.status(400).json({ error: 'jobId and instruction are required' });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (!job.projectPath) {
    return res.status(400).json({ error: 'Project not yet generated' });
  }

  const modId = uuidv4();
  res.json({ modId, message: 'Modification started' });

  // Apply modification asynchronously (Local Qwen2.5-VL-3B)
  const modifier = new CodeModifier();
  const log = (msg: string) => {
    job.logs.push(msg);
    sendJobEvent(job, { type: 'modification', modId, message: msg });
  };

  try {
    log(`[Modifier] 🚀 Applying user request: "${instruction}"`);
    sendJobEvent(job, { type: 'modification_start', modId, message: `Applying: "${instruction}"` });

    const result = await modifier.modify(job.projectPath, instruction, log);
    
    if (result.success) {
      log(`[Modifier] ✅ Applied: ${result.description}`);
      log(`[Modifier] 📁 Modified files: ${result.modifiedFiles.join(', ')}`);

      const followUpQuestion = `✨ Changes applied and updated live! Is there anything else you'd like to change?`;
      job.promptQuestion = followUpQuestion;
      log(`[Agent] 💬 ${followUpQuestion}`);

      sendJobEvent(job, { 
        type: 'modification_done', 
        modId, 
        success: true, 
        files: result.modifiedFiles,
        description: result.description,
        promptQuestion: followUpQuestion,
      });
    } else {
      log(`[Modifier] ⚠️ Modification error: ${result.error}. Attempting auto-fix...`);
      const fixResult = await modifier.fixBuildErrors(job.projectPath, result.error || 'Modification error', log);
      
      if (fixResult.success && fixResult.fixedFiles.length > 0) {
        log(`[Modifier] 🛡️ Auto-fixed: ${fixResult.explanation}`);
        const followUpQuestion = `✨ Fixes applied! Is there anything else you'd like to adjust?`;
        job.promptQuestion = followUpQuestion;
        
        sendJobEvent(job, { 
          type: 'modification_done', 
          modId, 
          success: true, 
          files: fixResult.fixedFiles,
          promptQuestion: followUpQuestion,
        });
      } else {
        log(`[Modifier] ❌ Failed: ${result.error}`);
        sendJobEvent(job, { type: 'modification_done', modId, success: false, error: result.error });
      }
    }
  } catch (err: any) {
    log(`[Modifier] ❌ Error: ${err.message}`);
    sendJobEvent(job, { type: 'modification_done', modId, success: false, error: err.message });
  }
});

// Get list of generated files
app.get('/api/files/:jobId', async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job || !job.projectPath) {
    return res.status(404).json({ error: 'Job or project not found' });
  }

  try {
    const files = await getProjectFiles(job.projectPath);
    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get file content
app.get('/api/files/:jobId/content', async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const { filePath } = req.query as { filePath: string };
  const job = jobs.get(jobId);

  if (!job || !job.projectPath) {
    return res.status(404).json({ error: 'Job or project not found' });
  }

  try {
    const fullPath = path.join(job.projectPath, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    res.json({ content, filePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List all jobs
app.get('/api/jobs', (_req: Request, res: Response) => {
  const jobList = Array.from(jobs.values()).map(j => ({
    id: j.id,
    status: j.status,
    url: j.url,
    previewUrl: j.previewUrl,
    whatWasBuilt: j.whatWasBuilt,
  }));
  res.json({ jobs: jobList });
});

async function getProjectFiles(projectPath: string): Promise<string[]> {
  const files: string[] = [];
  
  const readDir = async (dir: string, base: string = '') => {
    if (!(await fs.pathExists(dir))) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await readDir(path.join(dir, entry.name), relPath);
      } else {
        files.push(relPath);
      }
    }
  };

  await readDir(projectPath);
  return files;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  const builder = new ProjectBuilder();
  builder.stopAll();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║     🤖 AI Website Cloner Agent                       ║
║     Server running on http://localhost:${PORT}          ║
║     Generated projects: ./generated/                  ║
╚══════════════════════════════════════════════════════╝
  `);
});

export default app;
