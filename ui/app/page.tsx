

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import styles from './page.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  message: string;
  timestamp: string;
  type: 'log' | 'status' | 'analysis' | 'ready' | 'modification' | 'modification_done' | 'error';
}

interface Analysis {
  siteType: string;
  brandName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  headingFont: string;
  colorScheme: string;
  overallStyle: string;
  navigationStyle: string;
  componentList: string[];
  sections: Array<{ name: string; type: string; order: number }>;
}

interface WhatWasBuilt {
  brandName?: string;
  siteType?: string;
  components: string[];
  sectionsCount: number;
  filesCount: number;
  features?: string[];
}

interface DomReductionStats {
  rawHtmlBytes: number;
  compressedBytes: number;
  reductionPercentage: number;
}

type JobStatus = 'idle' | 'pending' | 'scraping' | 'analyzing' | 'generating' | 'building' | 'ready' | 'error';

interface FileItem {
  path: string;
  content?: string;
}

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:3001';

// ─── Helper Components ────────────────────────────────────────────────────────

function StatusDot({ status }: { status: JobStatus }) {
  const colors: Record<JobStatus, string> = {
    idle: '#475569',
    pending: '#6366f1',
    scraping: '#06b6d4',
    analyzing: '#8b5cf6',
    generating: '#f59e0b',
    building: '#f97316',
    ready: '#10b981',
    error: '#ef4444',
  };

  const isAnimating = !['idle', 'ready', 'error'].includes(status);

  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: colors[status],
        animation: isAnimating ? 'pulse 1.5s ease-in-out infinite' : 'none',
        flexShrink: 0,
      }}
    />
  );
}

function StageIndicator({ status }: { status: JobStatus }) {
  const stages = [
    { id: 'scraping', label: 'Scrape', icon: '🌐' },
    { id: 'analyzing', label: 'Analyze', icon: '🔍' },
    { id: 'generating', label: 'Generate', icon: '⚡' },
    { id: 'building', label: 'Build', icon: '🔨' },
    { id: 'ready', label: 'Ready', icon: '✅' },
  ];

  const stageOrder = ['scraping', 'analyzing', 'generating', 'building', 'ready'];
  const currentIdx = stageOrder.indexOf(status);

  return (
    <div className={styles.stageIndicator}>
      {stages.map((stage, idx) => {
        const isDone = currentIdx > idx;
        const isActive = currentIdx === idx;
        return (
          <div key={stage.id} className={styles.stageItem}>
            <div
              className={`${styles.stageDot} ${isDone ? styles.stageDone : ''} ${isActive ? styles.stageActive : ''}`}
            >
              <span>{isDone ? '✓' : stage.icon}</span>
            </div>
            <span className={`${styles.stageLabel} ${isActive ? styles.stageLabelActive : ''}`}>
              {stage.label}
            </span>
            {idx < stages.length - 1 && (
              <div className={`${styles.stageLine} ${isDone ? styles.stageLineDone : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: Analysis }) {
  return (
    <div className={styles.analysisCard}>
      <div className={styles.analysisHeader}>
        <span className={styles.analysisIcon}>🔬</span>
        <div>
          <h3 className={styles.analysisTitle}>{analysis.brandName}</h3>
          <span className={styles.analysisBadge}>{analysis.siteType}</span>
        </div>
      </div>

      <div className={styles.colorPalette}>
        <span className={styles.analysisSectionLabel}>Color Palette</span>
        <div className={styles.colorSwatches}>
          {[
            { color: analysis.primaryColor, label: 'Primary' },
            { color: analysis.secondaryColor, label: 'Secondary' },
            { color: analysis.accentColor, label: 'Accent' },
            { color: analysis.backgroundColor, label: 'BG' },
            { color: analysis.textColor, label: 'Text' },
          ].map(({ color, label }) => (
            <div key={label} className={styles.swatch} title={`${label}: ${color}`}>
              <div className={styles.swatchColor} style={{ backgroundColor: color }} />
              <span className={styles.swatchLabel}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.analysisMeta}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Style</span>
          <span className={styles.metaValue}>{analysis.overallStyle}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Font</span>
          <span className={styles.metaValue}>{analysis.fontFamily}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Nav</span>
          <span className={styles.metaValue}>{analysis.navigationStyle}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Colors</span>
          <span className={styles.metaValue}>{analysis.colorScheme}</span>
        </div>
      </div>

      {analysis.componentList && (
        <div className={styles.componentTags}>
          <span className={styles.analysisSectionLabel}>Components</span>
          <div className={styles.tags}>
            {analysis.componentList.map((comp) => (
              <span key={comp} className={styles.tag}>
                {comp}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [url, setUrl] = useState('');

  const [status, setStatus] = useState<JobStatus>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [modInstruction, setModInstruction] = useState('');
  const [isModifying, setIsModifying] = useState(false);
  const [activeTab, setActiveTab] = useState<'logs' | 'code' | 'preview'>('logs');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);

  // Agent interactive question & what-was-built state
  const [whatWasBuilt, setWhatWasBuilt] = useState<WhatWasBuilt | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<string>('');
  const [suggestedMods, setSuggestedMods] = useState<string[]>([]);
  const [autoFixCount, setAutoFixCount] = useState<number>(0);
  const [isApproved, setIsApproved] = useState<boolean>(false);
  const [iframeKey, setIframeKey] = useState<number>(0);

  // Playwright screenshot & Vision comparison state
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'split' | 'clone' | 'original'>('split');
  const [domReduction, setDomReduction] = useState<DomReductionStats | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Check agent health
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${AGENT_URL}/health`);
        setAgentOnline(res.ok);
      } catch {
        setAgentOnline(false);
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = useCallback((entry: Omit<LogEntry, 'timestamp'>) => {
    setLogs((prev) => [
      ...prev,
      { ...entry, timestamp: new Date().toLocaleTimeString() },
    ]);
  }, []);

  const startClone = async () => {
    if (!url.trim()) return;

    // Reset state
    setStatus('pending');
    setLogs([]);
    setPreviewUrl(null);
    setScreenshotUrl(null);
    setDomReduction(null);
    setAnalysis(null);
    setWhatWasBuilt(null);
    setAgentPrompt('');
    setAutoFixCount(0);
    setIsApproved(false);
    setFiles([]);
    setSelectedFile(null);
    setFileContent('');
    setActiveTab('logs');

    try {
      const res = await fetch(`${AGENT_URL}/api/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start clone job');
      }

      const { jobId: newJobId } = await res.json();
      setJobId(newJobId);

      // Connect to SSE stream
      connectToStream(newJobId);
    } catch (err: unknown) {
      setStatus('error');
      const message = err instanceof Error ? err.message : 'Unexpected error while starting the clone';
      addLog({ type: 'error', message: `❌ ${message}` });
    }
  };

  const connectToStream = (jId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${AGENT_URL}/api/status/${jId}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'log') {
          addLog({ type: 'log', message: data.message });
          if (data.status) setStatus(data.status as JobStatus);
        } else if (data.type === 'scraped') {
          if (data.screenshotUrl) setScreenshotUrl(`${AGENT_URL}${data.screenshotUrl}`);
          if (data.domReduction) setDomReduction(data.domReduction);
        } else if (data.type === 'status') {
          setStatus(data.status as JobStatus);
          if (data.previewUrl) setPreviewUrl(data.previewUrl);
          if (data.screenshotUrl) setScreenshotUrl(`${AGENT_URL}${data.screenshotUrl}`);
          if (data.domReduction) setDomReduction(data.domReduction);
          if (data.whatWasBuilt) setWhatWasBuilt(data.whatWasBuilt);
          if (data.promptQuestion) setAgentPrompt(data.promptQuestion);
          if (data.suggestedMods) setSuggestedMods(data.suggestedMods);
          if (data.autoFixCount) setAutoFixCount(data.autoFixCount);
        } else if (data.type === 'analysis') {
          setAnalysis(data.analysis);
        } else if (data.type === 'ready') {
          setPreviewUrl(data.previewUrl);
          setStatus('ready');
          if (data.screenshotUrl) setScreenshotUrl(`${AGENT_URL}${data.screenshotUrl}`);
          if (data.domReduction) setDomReduction(data.domReduction);
          if (data.whatWasBuilt) setWhatWasBuilt(data.whatWasBuilt);
          if (data.promptQuestion) setAgentPrompt(data.promptQuestion);
          if (data.suggestedMods) setSuggestedMods(data.suggestedMods);
          if (data.autoFixCount) setAutoFixCount(data.autoFixCount);
          addLog({ type: 'ready', message: `✅ Preview ready: ${data.previewUrl}` });
          setTimeout(() => setActiveTab('preview'), 500);
          // Keep SSE stream open for modification logs and follow-up prompts
        } else if (data.type === 'modification_start') {
          setIsModifying(true);
          addLog({ type: 'modification', message: data.message });
        } else if (data.type === 'modification') {
          addLog({ type: 'modification', message: data.message });
        } else if (data.type === 'modification_done') {
          setIsModifying(false);
          setIframeKey((k) => k + 1);
          if (data.success) {
            addLog({ type: 'log', message: `✅ Modification applied! Files: ${data.files?.join(', ')}` });
            if (data.promptQuestion) setAgentPrompt(data.promptQuestion);
          } else {
            addLog({ type: 'error', message: `❌ Modification failed: ${data.error}` });
          }
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };

    es.onerror = () => {
      // Don't aggressively close on minor disconnects; retry happens automatically
    };
  };

  const applyModification = async () => {
    if (!modInstruction.trim() || !jobId || isModifying) return;

    setIsModifying(true);
    addLog({ type: 'modification', message: `🔧 Applying: "${modInstruction}"` });

    try {
      const res = await fetch(`${AGENT_URL}/api/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, instruction: modInstruction }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to start modification');
      }
      setModInstruction('');
    } catch (err: unknown) {
      setIsModifying(false);
      const message = err instanceof Error ? err.message : 'Unexpected error while starting the modification';
      addLog({ type: 'error', message: `❌ ${message}` });
    }
  };

  const loadFiles = async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`${AGENT_URL}/api/files/${jobId}`);
      const data = await res.json();
      setFiles(data.files?.map((f: string) => ({ path: f })) || []);
      setActiveTab('code');
    } catch (e) {
      console.error('Failed to load files', e);
    }
  };

  const loadFileContent = async (filePath: string) => {
    if (!jobId) return;
    try {
      const res = await fetch(
        `${AGENT_URL}/api/files/${jobId}/content?filePath=${encodeURIComponent(filePath)}`
      );
      const data = await res.json();
      setSelectedFile(filePath);
      setFileContent(data.content || '');
    } catch (e) {
      console.error('Failed to load file content', e);
    }
  };

  const openPreview = () => {
    if (previewUrl) window.open(previewUrl, '_blank');
  };

  const isRunning = ['pending', 'scraping', 'analyzing', 'generating', 'building'].includes(status);

  const quickMods = [
    'Change the primary color to blue',
    'Make the navbar sticky',
    'Add a testimonials section',
    'Remove the pricing section',
    'Add a dark/light mode toggle',
    'Make the hero section fullscreen',
    'Add smooth scroll animations',
    'Replace hero with a bakery theme',
  ];

  return (
    <div className={styles.root}>
      {/* Background */}
      <div className={styles.bgOrbs}>
        <div className={`${styles.orb} ${styles.orb1}`} />
        <div className={`${styles.orb} ${styles.orb2}`} />
        <div className={`${styles.orb} ${styles.orb3}`} />
      </div>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <div className={styles.logoIcon}>⚡</div>
            <div>
              <span className={styles.logoText}>WebCloner</span>
              <span className={styles.logoBadge}>AI</span>
            </div>
          </div>
          <div className={styles.headerRight}>
            <div
              className={`${styles.agentStatus} ${agentOnline === true ? styles.agentOnline : agentOnline === false ? styles.agentOffline : styles.agentChecking}`}
            >
              <span className={styles.agentDot} />
              {agentOnline === true ? 'Agent Online' : agentOnline === false ? 'Agent Offline' : 'Checking...'}
            </div>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {/* Hero Input Section */}
        <section className={styles.hero}>
          <h1 className={styles.heroTitle}>
            Clone Any Website
            <br />
            <span className="text-gradient">with AI</span>
          </h1>
          <p className={styles.heroSubtitle}>
            Paste a URL → Playwright captures the UI → <strong>Local Qwen2.5-VL</strong> analyzes & generates the full frontend →
            no external AI API keys required; website access and dependency installation still need internet
          </p>

          {/* Local Model Badges */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', fontSize: 12, color: '#c4b5fd', fontWeight: 600 }}>
              <span style={{ fontSize: 14 }}>🖥️</span> 100% Single Local Model: Qwen2.5-VL-3B
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', fontSize: 12, color: '#a5b4fc', fontWeight: 600 }}>
              <span style={{ fontSize: 14 }}>🚀</span> Ollama + RTX GPU (Zero Cloud APIs)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', fontSize: 12, color: '#6ee7b7', fontWeight: 600 }}>
              <span style={{ fontSize: 14 }}>🛡️</span> Autonomous Self-Healing & Verification
            </div>
          </div>

          {/* URL Input */}
          <div className={styles.urlSection}>
            <label className={styles.label} htmlFor="urlInput">
              🌐 Website URL to Clone
            </label>
            <div className={styles.urlInputRow}>
              <input
                id="urlInput"
                type="url"
                className="input"
                placeholder="https://stripe.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isRunning && startClone()}
                disabled={isRunning}
              />
              <button
                id="cloneBtn"
                className="btn btn-primary"
                onClick={startClone}
                disabled={isRunning || !url}
                style={{ flexShrink: 0, minWidth: 140, padding: '12px 24px', fontSize: 15 }}
              >
                {isRunning ? (
                  <>
                    <span className="spin" style={{ display: 'inline-block' }}>⚙️</span>
                    Cloning...
                  </>
                ) : (
                  <>⚡ Clone It</>
                )}
              </button>
            </div>
          </div>

          {/* Example URLs */}
          <div className={styles.examples}>
            <span className={styles.examplesLabel}>Try:</span>
            {['https://stripe.com', 'https://linear.app', 'https://vercel.com', 'https://notion.so'].map((ex) => (
              <button
                key={ex}
                className="btn btn-ghost"
                onClick={() => setUrl(ex)}
                style={{ fontSize: 12, padding: '4px 12px' }}
              >
                {ex.replace('https://', '')}
              </button>
            ))}
          </div>
        </section>

        {/* Pipeline Status */}
        {status !== 'idle' && (
          <section className={`${styles.pipelineSection} slide-up`}>
            <div className={styles.pipelineHeader}>
              <div className={styles.pipelineStatus}>
                <StatusDot status={status} />
                <span className={styles.pipelineStatusText}>
                  {status === 'ready' ? '✅ Generation Complete' : status === 'error' ? '❌ Error occurred' : '🔄 Pipeline Running...'}
                </span>
                {domReduction && (
                  <span style={{ 
                    padding: '2px 10px', 
                    background: 'rgba(6, 182, 212, 0.15)', 
                    border: '1px solid rgba(6, 182, 212, 0.35)', 
                    borderRadius: 20, 
                    fontSize: 11, 
                    color: '#22d3ee', 
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    marginLeft: 8,
                  }}>
                    ⚡ DOM Reduced by {domReduction.reductionPercentage}% (Clean AX Layout)
                  </span>
                )}
              </div>
              {previewUrl && (
                <button className="btn btn-primary" onClick={openPreview}>
                  🚀 Open Preview
                </button>
              )}
            </div>

            <StageIndicator status={status} />

            {/* Tabs */}
            <div className={styles.tabs}>
              <button
                className={`${styles.tab} ${activeTab === 'logs' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('logs')}
                id="tab-logs"
              >
                📋 Logs
                {logs.length > 0 && <span className={styles.tabBadge}>{logs.length}</span>}
              </button>
              {analysis && (
                <button
                  className={`${styles.tab} ${activeTab === 'code' ? styles.tabActive : ''}`}
                  onClick={() => { loadFiles(); }}
                  id="tab-code"
                >
                  💻 Code
                </button>
              )}
              {previewUrl && (
                <button
                  className={`${styles.tab} ${activeTab === 'preview' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('preview')}
                  id="tab-preview"
                >
                  🖥️ Preview
                </button>
              )}
            </div>

            {/* Logs Panel */}
            {activeTab === 'logs' && (
              <div className={styles.logsPanel}>
                {logs.map((log, i) => (
                  <div key={i} className={`${styles.logEntry} ${styles[`logEntry_${log.type}`] || ''}`}>
                    <span className={styles.logTime}>{log.timestamp}</span>
                    <span className={styles.logMsg}>{log.message}</span>
                  </div>
                ))}
                {isRunning && (
                  <div className={styles.logEntry}>
                    <span className={styles.logTime}>{new Date().toLocaleTimeString()}</span>
                    <span className={styles.logMsg} style={{ color: '#6366f1' }}>
                      <span className="spin" style={{ display: 'inline-block', marginRight: 6 }}>⚙️</span>
                      Processing...
                    </span>
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            )}

            {/* Code Panel */}
            {activeTab === 'code' && (
              <div className={styles.codePanel}>
                <div className={styles.fileTree}>
                  <div className={styles.fileTreeHeader}>📁 Project Files</div>
                  {files.map((file) => (
                    <button
                      key={file.path}
                      className={`${styles.fileItem} ${selectedFile === file.path ? styles.fileItemActive : ''}`}
                      onClick={() => loadFileContent(file.path)}
                    >
                      <span className={styles.fileIcon}>
                        {file.path.endsWith('.tsx') || file.path.endsWith('.ts') ? '⚛️' : 
                         file.path.endsWith('.css') ? '🎨' : 
                         file.path.endsWith('.json') ? '📋' : '📄'}
                      </span>
                      {file.path}
                    </button>
                  ))}
                </div>
                <div className={styles.fileContent}>
                  {fileContent ? (
                    <pre className={styles.codeContent}>{fileContent}</pre>
                  ) : (
                    <div className={styles.fileContentEmpty}>
                      <span style={{ fontSize: 40 }}>📂</span>
                      <p>Select a file to view its content</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Preview Panel */}
            {activeTab === 'preview' && previewUrl && (
              <div className={styles.previewPanel}>
                <div className={styles.previewToolbar}>
                  <div className={styles.previewDots}>
                    <span style={{ background: '#ef4444' }} />
                    <span style={{ background: '#f59e0b' }} />
                    <span style={{ background: '#10b981' }} />
                  </div>

                  {screenshotUrl && (
                    <div className={styles.previewModeSelector}>
                      <button
                        className={`${styles.modeBtn} ${previewMode === 'split' ? styles.modeBtnActive : ''}`}
                        onClick={() => setPreviewMode('split')}
                        title="Side-by-side comparison"
                      >
                        🔀 Split View
                      </button>
                      <button
                        className={`${styles.modeBtn} ${previewMode === 'clone' ? styles.modeBtnActive : ''}`}
                        onClick={() => setPreviewMode('clone')}
                        title="Live Next.js Clone"
                      >
                        ⚡ Live Clone
                      </button>
                      <button
                        className={`${styles.modeBtn} ${previewMode === 'original' ? styles.modeBtnActive : ''}`}
                        onClick={() => setPreviewMode('original')}
                        title="Original Playwright Screenshot"
                      >
                        📸 Original UI
                      </button>
                    </div>
                  )}

                  <span className={styles.previewUrl}>{previewUrl}</span>
                  <button className="btn btn-ghost" onClick={openPreview} style={{ marginLeft: 'auto', fontSize: 12 }}>
                    ↗ Open Live
                  </button>
                </div>

                {previewMode === 'split' && screenshotUrl ? (
                  <div className={styles.splitPreviewGrid}>
                    <div className={styles.splitColumn}>
                      <div className={styles.splitColumnHeader}>
                        <span>📸 Original Target (Playwright Capture)</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Target Reference</span>
                      </div>
                      <div className={styles.screenshotContainer}>
                        <img
                          src={screenshotUrl}
                          alt="Original Website Captured with Playwright"
                          className={styles.originalScreenshotImg}
                        />
                      </div>
                    </div>
                    <div className={styles.splitColumn}>
                      <div className={styles.splitColumnHeader}>
                        <span>⚡ AI Frontend Clone (Vision Recreated)</span>
                        <span style={{ color: '#10b981', fontSize: 10 }}>● Next.js Active</span>
                      </div>
                      <iframe
                        key={iframeKey}
                        src={previewUrl}
                        className={styles.splitIframe}
                        title="Generated Website Preview"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                      />
                    </div>
                  </div>
                ) : previewMode === 'original' && screenshotUrl ? (
                  <div className={styles.screenshotContainer} style={{ height: 540 }}>
                    <img
                      src={screenshotUrl}
                      alt="Original Website Captured with Playwright"
                      className={styles.originalScreenshotImg}
                    />
                  </div>
                ) : (
                  <iframe
                    key={iframeKey}
                    src={previewUrl}
                    className={styles.previewIframe}
                    title="Generated Website Preview"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                  />
                )}
              </div>
            )}
          </section>
        )}

        {/* Analysis Card */}
        {analysis && (
          <section className={`${styles.analysisSection} slide-up`}>
            <AnalysisCard analysis={analysis} />
          </section>
        )}

        {/* Interactive Agent Inquiry & Modification Panel */}
        {status === 'ready' && (
          isApproved ? (
            <section className={`${styles.finalizedBanner} slide-up`}>
              <div className={styles.finalizedText}>
                <span style={{ fontSize: 36 }}>🎉</span>
                <div>
                  <h3 className={styles.finalizedTitle}>Website Finalized & Functional!</h3>
                  <p className={styles.finalizedSub}>
                    Your cloned frontend is live at <strong>{previewUrl}</strong> and all source code is saved in your project directory.
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" onClick={openPreview}>
                  🚀 Open Preview
                </button>
                <button className="btn btn-ghost" onClick={() => setIsApproved(false)}>
                  🔄 Make More Changes
                </button>
              </div>
            </section>
          ) : (
            <section className={`${styles.agentInquiryCard} slide-up`}>
              <div className={styles.agentInquiryHeader}>
                <div className={styles.agentIdentity}>
                  <div className={styles.agentAvatar}>🤖</div>
                  <div>
                    <h3 className={styles.agentTitle}>AI Frontend Agent</h3>
                    <span className={styles.agentBadgeActive}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
                      Build Ready • Awaiting Your Feedback
                    </span>
                  </div>
                </div>
                {previewUrl && (
                  <button className="btn btn-ghost" onClick={openPreview} style={{ fontSize: 13 }}>
                    ↗ Open in Browser
                  </button>
                )}
              </div>

              {autoFixCount > 0 && (
                <div className={styles.autoFixAlert}>
                  <span>🛡️</span>
                  <span>
                    <strong>Self-Healing Active:</strong> The agent automatically detected and resolved {autoFixCount} compilation/type error(s) during verification to ensure your website is 100% functional.
                  </span>
                </div>
              )}

              {whatWasBuilt && (
                <div className={styles.builtManifest}>
                  <span className={styles.builtManifestLabel}>🏗️ What Was Built:</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {whatWasBuilt.siteType} with {whatWasBuilt.sectionsCount} sections ({whatWasBuilt.filesCount} files)
                  </span>
                  <div className={styles.builtComponentPills}>
                    {whatWasBuilt.components.map((comp) => (
                      <span key={comp} className={styles.builtPill}>{comp}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.agentQuestionBubble}>
                <span style={{ fontSize: 22 }}>💬</span>
                <div className={styles.agentQuestionText}>
                  {agentPrompt || "Your website has been successfully built and is running! Is there anything you would like to change or customize?"}
                </div>
              </div>

              <div className={styles.modActionRow}>
                <input
                  id="modInput"
                  type="text"
                  className="input"
                  placeholder='e.g. "Change the color palette to emerald & dark", "Add a testimonials section", or "Make navbar sticky"'
                  value={modInstruction}
                  onChange={(e) => setModInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyModification()}
                />
                <button
                  id="applyModBtn"
                  className="btn btn-primary"
                  onClick={applyModification}
                  disabled={isModifying || !modInstruction.trim()}
                  style={{ minWidth: 130 }}
                >
                  {isModifying ? (
                    <>
                      <span className="spin" style={{ display: 'inline-block', marginRight: 6 }}>⚙️</span>
                      Applying...
                    </>
                  ) : (
                    '✨ Apply Change'
                  )}
                </button>
                <button
                  className={styles.finalizeBtn}
                  onClick={() => {
                    setIsApproved(true);
                    addLog({ type: 'ready', message: '🎉 Build approved by user! Site is fully functional.' });
                  }}
                >
                  👍 Looks Great (Done)
                </button>
              </div>

              <div className={styles.quickMods}>
                <span className={styles.quickModsLabel}>Quick Suggestion Chips:</span>
                <div className={styles.quickModsGrid}>
                  {(suggestedMods.length > 0 ? suggestedMods : quickMods).map((mod) => (
                    <button
                      key={mod}
                      className={styles.quickModBtn}
                      onClick={() => setModInstruction(mod)}
                      id={`quick-mod-${mod.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30)}`}
                    >
                      {mod}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )
        )}

        {/* Feature Cards */}
        {status === 'idle' && (
          <section className={styles.featuresSection}>
            {[
              {
                icon: '🌐',
                title: 'Intelligent Scraping',
                desc: 'Playwright captures full-page screenshots, DOM structure, computed styles, fonts, and colors.',
              },
              {
                icon: '🔬',
                title: 'Local Vision Analysis',
                desc: 'Vision AI analyzes the screenshot to understand layout, design system, color palette, and brand.',
              },
              {
                icon: '⚡',
                title: 'Next.js Generation',
                desc: 'Generates clean TypeScript React components for every section detected on the page.',
              },
              {
                icon: '🧠',
                title: 'Natural Language Mods',
                desc: 'Modify any part of the cloned site using plain English instructions, applied instantly.',
              },
              {
                icon: '🔨',
                title: 'Auto Error Fix',
                desc: 'Detects build errors and uses AI to automatically fix them before previewing.',
              },
              {
                icon: '🚀',
                title: 'Instant Preview',
                desc: 'Dev server starts automatically with hot-reload so changes reflect immediately.',
              },
            ].map((feat) => (
              <div key={feat.title} className={`${styles.featureCard} glass-card`}>
                <div className={styles.featureIcon}>{feat.icon}</div>
                <h3 className={styles.featureTitle}>{feat.title}</h3>
                <p className={styles.featureDesc}>{feat.desc}</p>
              </div>
            ))}
          </section>
        )}
      </main>

      <footer className={styles.footer}>
        <p>AI Website Cloner • Powered by local vision AI + Next.js</p>
      </footer>
    </div>
  );
}
