/**
 * Agentic Orchestrator — 100% Single Local Model (Never-Throw Architecture)
 * ──────────────────────────────────────────────────────────────────
 * Powered exclusively by local Qwen2.5-VL-3B running via Ollama (RTX GPU).
 *
 * All operations:
 *  - Screenshot & visual UI/UX analysis
 *  - Global CSS & token generation
 *  - Direct visual component code generation
 *  - Next.js page generation
 *  - Self-healing auto-repair of build / type errors
 *  - Natural language code modifications
 *
 * No external API keys (OpenRouter or HuggingFace) required.
 */

import axios from 'axios';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModelTier = 'vision' | 'fallback' | 'lite';

export interface OrchestratorConfig {
  ollamaBaseUrl?: string;  // Local Ollama URL (default: http://127.0.0.1:11434)
  ollamaModel?: string;    // Local Ollama model (default: qwen2.5vl:3b)
  maxRetries?: number;
  timeoutMs?: number;
  // Deprecated backwards-compatibility fields (ignored)
  openrouterApiKey?: string;
  geminiApiKey?: string;
  hfApiKey?: string;
}

export interface CallOptions {
  tier?: ModelTier;
  systemPrompt?: string;
  imageBase64?: string;    // for vision calls
  jsonMode?: boolean;
  maxTokens?: number;
  taskLabel?: string;      // for logging
}

export interface OrchestratorResult {
  text: string;
  modelUsed: string;
  tier: ModelTier;
  retries: number;
  latencyMs: number;
  fallbackReason?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const RETRY_BASE_MS = 2000;
const MAX_RETRIES = 5;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Orchestrator Class ────────────────────────────────────────────────────────

export class AgentOrchestrator {
  private config: OrchestratorConfig;
  private log: (msg: string) => void;

  constructor(config: OrchestratorConfig = {}, log?: (msg: string) => void) {
    this.config = config;
    this.log = log || console.log;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Route call to the single local Qwen2.5-VL model with retry handling.
   */
  async call(prompt: string, options: CallOptions = {}): Promise<OrchestratorResult> {
    const { tier = 'vision', taskLabel = 'task' } = options;
    const start = Date.now();
    const ollamaUrl = (this.config.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const ollamaModel = this.config.ollamaModel || process.env.OLLAMA_VL_MODEL || 'qwen2.5vl:3b';

    this.log(`[Orchestrator] 🖥️ ${taskLabel} → Local Model: ${ollamaModel}`);

    try {
      const text = await this.callWithRetry(
        () => this.callOllamaQwen(prompt, options, ollamaUrl, ollamaModel),
        `Local Qwen2.5-VL (${ollamaModel})`,
        taskLabel
      );

      return {
        text,
        modelUsed: `Local-${ollamaModel}`,
        tier,
        retries: 0,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      // ── Never-Throw Safety Net ──────────────────────────────────────────────
      // All retries exhausted. Return empty text instead of crashing the pipeline.
      // The caller (builder/generator) must handle empty responses gracefully.
      this.log(`[Orchestrator] ❌ All retries exhausted for "${taskLabel}": ${err.message}. Returning empty response to prevent pipeline crash.`);
      return {
        text: '',
        modelUsed: `Local-${ollamaModel} (FAILED)`,
        tier,
        retries: MAX_RETRIES,
        latencyMs: Date.now() - start,
        fallbackReason: `All ${MAX_RETRIES} retries exhausted: ${err.message}`,
      };
    }
  }

  // ── Internal Callers ───────────────────────────────────────────────────────

  private async callWithRetry<T>(
    fn: () => Promise<T>,
    modelName: string,
    taskLabel: string
  ): Promise<T> {
    let lastErr: any;
    const maxRetries = this.config.maxRetries ?? MAX_RETRIES;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const delay = Math.min(RETRY_BASE_MS * attempt, 15000); // cap at 15s
        const isConnRefused = err.message?.includes('ECONNREFUSED') || err.code === 'ECONNREFUSED';
        const isTimeout = err.message?.includes('timeout') || err.code === 'ECONNABORTED';

        if (isConnRefused) {
          this.log(`[Orchestrator] 🔴 Ollama not responding on "${taskLabel}" (attempt ${attempt}/${maxRetries}). Waiting ${delay}ms for service to start...`);
        } else if (isTimeout) {
          this.log(`[Orchestrator] ⏱️ ${modelName} timed out on "${taskLabel}" (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`);
        } else {
          this.log(`[Orchestrator] ⚠️ ${modelName} error on "${taskLabel}": ${err.message} (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms…`);
        }
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  /** Call local Qwen2.5-VL model running on Ollama (RTX GPU) */
  private async callOllamaQwen(
    prompt: string,
    options: CallOptions,
    ollamaUrl: string,
    modelName: string
  ): Promise<string> {
    const messages: any[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    const userContent: any[] = [];
    if (options.imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${options.imageBase64}`,
        },
      });
    }
    userContent.push({ type: 'text', text: prompt });
    messages.push({ role: 'user', content: userContent });

    // Vision calls need longer timeout — model processes large image tokens
    const timeoutMs = options.imageBase64
      ? (this.config.timeoutMs ?? 300_000)  // 5 minutes for vision tasks
      : (this.config.timeoutMs ?? 240_000); // 4 minutes for text/repair tasks

    const response = await axios.post(
      `${ollamaUrl}/v1/chat/completions`,
      {
        model: modelName,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: 0.3,
        stream: false,
        keep_alive: '-1',
        options: {
          num_ctx: 16384,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: timeoutMs,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from local Ollama Qwen');
    return content;
  }

  // ── Convenience Helpers ────────────────────────────────────────────────────

  /** Vision call — Local Qwen2.5-VL-3B */
  async vision(prompt: string, imageBase64: string, systemPrompt?: string, taskLabel?: string): Promise<OrchestratorResult> {
    return this.call(prompt, { tier: 'vision', imageBase64, systemPrompt, taskLabel });
  }

  /** Modification call — Local Qwen2.5-VL-3B */
  async modify(prompt: string, systemPrompt?: string, taskLabel?: string): Promise<OrchestratorResult> {
    return this.call(prompt, { tier: 'lite', systemPrompt, taskLabel });
  }

  /** Rebuild / repair call — Local Qwen2.5-VL-3B */
  async rebuild(prompt: string, systemPrompt?: string, taskLabel?: string): Promise<OrchestratorResult> {
    return this.call(prompt, { tier: 'fallback', systemPrompt, taskLabel });
  }
}
