/**
 * CodeGenerator — Vision-Powered with Local Qwen2.5-VL
 * ──────────────────────────────────────────────────────────
 * Powered 100% locally by Qwen2.5-VL-3B (Ollama / RTX GPU)
 * Zero cloud API keys required.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { ScrapedData } from '../scraper';
import { WebsiteAnalysis } from '../analyzer';
import { AgentOrchestrator } from '../orchestrator';

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerationResult {
  files: GeneratedFile[];
  projectPath: string;
  dependencies: string[];
}

export class CodeGenerator {
  private orchestrator: AgentOrchestrator;
  private generatedDir: string;

  constructor(arg1?: string, arg2?: string, _hfApiKey?: string) {
    this.generatedDir = (arg2 && typeof arg2 === 'string') ? arg2 : (arg1 || './generated');
    this.orchestrator = new AgentOrchestrator({
      maxRetries: 3,
      timeoutMs: 180_000,
    });
  }

  async generate(
    scraped: ScrapedData,
    analysis: WebsiteAnalysis,
    jobId: string,
    onProgress?: (msg: string) => void
  ): Promise<GenerationResult> {
    const progress = onProgress || console.log;
    const projectName = `clone-${jobId}`;
    const projectPath = path.join(this.generatedDir, projectName);

    progress('[Generator] 🚀 Generating Next.js frontend from structured scraped data (Local Qwen2.5)...');

    progress('[Generator] 🎨 Generating design system from scraped colors & typography...');
    const globalCss = await this.generateGlobalCSS(analysis, scraped, progress);

    progress('[Generator] ⚡ Building components directly from scraped sections & layout...');
    const components = await this.generateComponents(scraped, analysis, progress);

    progress('[Generator] 📄 Generating Next.js pages...');
    const pages = await this.generatePages(analysis, components);

    progress('[Generator] 🔧 Assembling Next.js project structure...');
    const files = this.assembleProject(projectName, globalCss, components, pages, analysis);

    progress('[Generator] 💾 Writing files to disk...');
    await this.writeFiles(projectPath, files);

    progress('[Generator] ✅ Code generation complete!');
    return { files, projectPath, dependencies: this.getDependencies() };
  }

  // ── CSS Generation (Scraped Data → Local Qwen) ─────────────────────────────

  private async generateGlobalCSS(
    analysis: WebsiteAnalysis,
    scraped: ScrapedData,
    progress?: (msg: string) => void
  ): Promise<string> {
    const systemPrompt =
      'You are an expert CSS developer and UI designer. Generate clean, modern CSS. Return ONLY valid CSS, no markdown fences.';

    const userPrompt = `You are analyzing the scraped design data of the website to recreate.
Generate a comprehensive globals.css file for a Next.js project replicating the exact visual atmosphere, colors, spacing, and typography.

Design System from Scraped Data:
- Primary Color: ${analysis.primaryColor}
- Secondary Color: ${analysis.secondaryColor}
- Accent Color: ${analysis.accentColor}
- Background: ${analysis.backgroundColor}
- Text Color: ${analysis.textColor}
- Font Family: ${analysis.fontFamily}
- Heading Font: ${analysis.headingFont}
- Style: ${analysis.overallStyle}
- Color Scheme: ${analysis.colorScheme}
- Scraped Palette: ${scraped.colors.slice(0, 10).join(', ')}
- Scraped Fonts: ${scraped.fonts.slice(0, 5).join(', ')}

Include:
1. CSS custom properties (--primary, --secondary, --accent, --background, --text, --border, --radius, --shadow)
2. CSS reset/normalize
3. Base body styles matching the background and typography
4. Typography styles (h1-h6, p, a) matching the visual scale
5. Smooth scrolling
6. Responsive container utility
7. Button base styles (.btn-primary, .btn-secondary)
8. Animation keyframes (fadeIn, slideUp, fadeInLeft, pulse)
9. Utility classes (.container, .section-padding, .glass-card, .gradient-text)
10. @import Google Fonts
11. Scrollbar styling
12. Media queries for mobile (max-width: 768px)
Return ONLY the CSS content, no markdown.`;

    const result = await this.orchestrator.rebuild(userPrompt, systemPrompt, 'CSS Generation');

    if (progress) {
      progress(`[Generator] 🎨 CSS generated via ${result.modelUsed} (${result.latencyMs}ms)${result.fallbackReason ? ` [fallback: ${result.fallbackReason}]` : ''}`);
    }

    if (!result.text || !result.text.trim()) {
      return `:root {
  --primary: ${analysis.primaryColor || '#6366f1'};
  --secondary: ${analysis.secondaryColor || '#a855f7'};
  --accent: ${analysis.accentColor || '#ec4899'};
  --background: ${analysis.backgroundColor || '#090d16'};
  --text: ${analysis.textColor || '#f8fafc'};
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--background); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
a { color: inherit; text-decoration: none; }
`;
    }

    return this.cleanCode(result.text);
  }

  // ── Component Generation (Scraped Data per section) ────────────────────────

  private async generateComponents(
    scraped: ScrapedData,
    analysis: WebsiteAnalysis,
    progress: (msg: string) => void
  ): Promise<GeneratedFile[]> {
    const components: GeneratedFile[] = [];
    const componentCounts = new Map<string, number>();
    const sorted = [...analysis.sections].sort((a, b) => a.order - b.order);

    for (const section of sorted) {
      const baseName = this.sectionToComponentName(section.name);
      const occurrence = (componentCounts.get(baseName) || 0) + 1;
      componentCounts.set(baseName, occurrence);
      const componentName = occurrence === 1 ? baseName : `${baseName}${occurrence}`;

      progress(`[Generator] ⚡ Building ${componentName} component from scraped section data...`);
      const component = await this.generateComponent(section, componentName, analysis, scraped, progress);
      if (component) components.push(component);
    }
    return components;
  }

  private async generateComponent(
    section: WebsiteAnalysis['sections'][0],
    componentName: string,
    analysis: WebsiteAnalysis,
    scraped: ScrapedData,
    progress: (msg: string) => void
  ): Promise<GeneratedFile | null> {
    const navLinks = scraped.navigation.links
      .map(l => `{ label: '${l.text}', href: '${l.href.replace(scraped.url, '')}' }`)
      .join(', ');
    const imageAssets = scraped.images
      .slice(0, 12)
      .map(image => `- ${image.src}${image.alt ? ` (alt: ${image.alt})` : ''}`)
      .join('\n');

    // Match scraped section for rich content and text
    const matchedSection = scraped.sections.find(s => 
      s.tag.toLowerCase().includes(section.name.toLowerCase()) ||
      s.classes.toLowerCase().includes(section.name.toLowerCase()) ||
      s.text.toLowerCase().includes(section.name.toLowerCase())
    );
    const sectionExcerpt = matchedSection ? matchedSection.text.slice(0, 400) : section.content;

    const systemPrompt = `You are a senior React/Next.js developer recreating a website section in Next.js 14 App Router.
Rules:
- Add 'use client'; directive at the very top of the file
- Use CSS variables from globals.css (--primary, --secondary, --accent, --background, --text, --border)
- Make components fully self-contained with realistic content matching the scraped website
- Use lucide-react icons where appropriate
- Fully responsive on mobile and desktop with clean hover effects
- Return ONLY valid TSX, no markdown fences.`;

    const userPrompt = `Recreate the "${section.name}" (${section.type}) section in React/Next.js TypeScript.

SCRAPED WEBSITE DATA FOR THIS SECTION:
- Section Name: ${section.name}
- Type: ${section.type}
- Description: ${section.description}
- Content / Text from Page: "${sectionExcerpt || section.content || section.name}"
- Brand Name: ${analysis.brandName}
- Style: ${analysis.overallStyle}
- Colors: Primary ${analysis.primaryColor}, Accent ${analysis.accentColor}, Background ${analysis.backgroundColor}, Text ${analysis.textColor}
- Font: ${analysis.fontFamily}
- Layout: ${section.layout}
- Has Images: ${section.hasImages}
- Has CTA: ${section.hasCTA}
${imageAssets ? `- Available original image assets:\n${imageAssets}` : ''}
${navLinks ? `- Navigation Links: [${navLinks}]` : ''}

IMPLEMENTATION GUIDELINES:
1. If Navbar: Brand logo "${analysis.brandName}", navigation links, and CTA button. Include responsive hamburger menu with useState toggle.
2. If Hero: Prominent headline, compelling subheadline, CTA buttons with hover animations, badges.
3. If Features/Grid: Modern grid layout of cards with lucide-react icons, title, description, border styling.
4. If Pricing: Tiered cards, monthly/annual toggle with useState, feature lists with checkmarks, popular badge, CTA button.
5. If Testimonials: Customer review cards with avatars/initials, quotes, star ratings, reviewer names and titles.
6. If Footer: Multiple navigation columns, copyright notice, social link icons, newsletter input.
7. If Other: Engaging, responsive section matching the brand palette and modern aesthetic.
8. When image assets are listed, reuse relevant original image URLs in standard <img> elements with descriptive alt text; do not replace them with unrelated stock imagery.

Return ONLY complete TSX code. No markdown fences.`;

    const result = await this.orchestrator.rebuild(userPrompt, systemPrompt, `Component: ${componentName}`);

    progress(`[Generator] ✅ ${componentName} via ${result.modelUsed} (${result.latencyMs}ms)${result.fallbackReason ? ` [fallback: ${result.fallbackReason}]` : ''}`);

    const content = result.text;
    if (!content || !content.trim()) {
      progress(`[Generator] ⚠️ Empty response for ${componentName}, generating clean fallback component.`);
      const fallback = `'use client';\n\nimport React from 'react';\n\nexport default function ${componentName}() {\n  return (\n    <section id="${componentName.toLowerCase()}" style={{ padding: '4rem 2rem', textAlign: 'center', background: 'var(--background, #0a0a0a)', color: 'var(--text, #fff)' }}>\n      <h2 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '1rem' }}>${section.name}</h2>\n      <p style={{ color: 'var(--secondary, #aaa)', maxWidth: 600, margin: '0 auto' }}>${section.description || 'Welcome to ' + analysis.brandName}</p>\n    </section>\n  );\n}\n`;
      return {
        path: `components/${componentName}.tsx`,
        content: fallback,
      };
    }
    return {
      path: `components/${componentName}.tsx`,
      content: this.cleanCode(content),
    };
  }

  // ── Pages ─────────────────────────────────────────────────────────────────

  private async generatePages(
    analysis: WebsiteAnalysis,
    components: GeneratedFile[]
  ): Promise<GeneratedFile[]> {
    const componentImports = components
      .map(c => {
        const name = path.basename(c.path, '.tsx');
        return `import ${name} from '@/components/${name}';`;
      })
      .join('\n');

    const componentUsages = components
      .map(c => `      <${path.basename(c.path, '.tsx')} />`)
      .join('\n');

    return [{
      path: 'app/page.tsx',
      content: `import type { Metadata } from 'next';
${componentImports}

export const metadata: Metadata = {
  title: ${JSON.stringify(analysis.brandName)},
  description: ${JSON.stringify(`${analysis.brandName} - ${analysis.siteType}`)},
};

export default function Home() {
  return (
    <main>
${componentUsages}
    </main>
  );
}
`,
    }];
  }

  // ── Project Assembly ──────────────────────────────────────────────────────

  private assembleProject(
    projectName: string,
    globalCss: string,
    components: GeneratedFile[],
    pages: GeneratedFile[],
    analysis: WebsiteAnalysis
  ): GeneratedFile[] {
    return [
      {
        path: 'package.json',
        content: JSON.stringify({
          name: projectName,
          version: '0.1.0',
          private: true,
          scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
          dependencies: {
            next: '14.0.4',
            react: '^18',
            'react-dom': '^18',
            'framer-motion': '^10.16.16',
            'lucide-react': '^0.303.0',
          },
          devDependencies: {
            typescript: '^5',
            '@types/node': '^20',
            '@types/react': '^18',
            '@types/react-dom': '^18',
            eslint: '^8',
            'eslint-config-next': '14.0.4',
          },
        }, null, 2),
      },
      {
        path: 'tsconfig.json',
        content: JSON.stringify({
          compilerOptions: {
            target: 'es5', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true,
            skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true,
            module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true,
            isolatedModules: true, jsx: 'preserve', incremental: true,
            plugins: [{ name: 'next' }], paths: { '@/*': ['./*'] },
          },
          include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
          exclude: ['node_modules'],
        }, null, 2),
      },
      {
        path: 'next.config.js',
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }, { protocol: 'http', hostname: '**' }] },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};
module.exports = nextConfig;
`,
      },
      {
        path: 'app/layout.tsx',
        content: `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: ${JSON.stringify(analysis.brandName)},
  description: ${JSON.stringify(`${analysis.brandName} - Powered by AI Website Cloner`)},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      },
      { path: 'app/globals.css', content: globalCss },
      ...components,
      ...pages,
    ];
  }

  private async writeFiles(projectPath: string, files: GeneratedFile[]): Promise<void> {
    await fs.ensureDir(projectPath);
    for (const file of files) {
      const filePath = path.join(projectPath, file.path);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, file.content, 'utf-8');
    }
  }

  private sectionToComponentName(name: string): string {
    const lower = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const map: Record<string, string> = {
      navbar: 'Navbar', nav: 'Navbar', header: 'Navbar', hero: 'Hero', banner: 'Hero',
      features: 'Features', feature: 'Features', about: 'About', pricing: 'Pricing',
      testimonials: 'Testimonials', testimonial: 'Testimonials', team: 'Team',
      contact: 'Contact', footer: 'Footer', cta: 'CTA', stats: 'Stats',
      gallery: 'Gallery', blog: 'Blog', faq: 'FAQ', clients: 'Clients', services: 'Services',
    };
    return map[lower] || this.capitalize(name);
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
  }

  private cleanCode(code: string): string {
    let cleaned = code.trim();

    // 1. Remove markdown code fences and identifiers
    cleaned = cleaned.replace(/^```[a-z0-9_-]*\s*\n?/i, '');
    cleaned = cleaned.replace(/\n?```\s*$/i, '');
    cleaned = cleaned.replace(/^(?:typescript|tsx|jsx|javascript|ts|js|css)\s*\n/i, '');

    // Strip leading conversational non-code preamble before the first real code statement
    const rawLines = cleaned.split('\n');
    let firstCodeIdx = -1;
    for (let i = 0; i < rawLines.length; i++) {
      const trimmed = rawLines[i].trim();
      if (!trimmed) continue;
      if (
        /^['"]use (client|server)['"]/.test(trimmed) ||
        /^import\s+/.test(trimmed) ||
        /^export\s+/.test(trimmed) ||
        /^(const|let|var|function|class|type|interface|enum)\s+/.test(trimmed) ||
        /^\/\//.test(trimmed) ||
        /^\/\*/.test(trimmed) ||
        /^<[A-Za-z]/.test(trimmed) ||
        /^@(?:tailwind|import|layer|apply|keyframes)/.test(trimmed) ||
        /^:[a-z0-9_-]/.test(trimmed) ||
        /^[.#a-z0-9_-]+\s*\{/i.test(trimmed)
      ) {
        firstCodeIdx = i;
        break;
      }
    }
    if (firstCodeIdx > 0) {
      cleaned = rawLines.slice(firstCodeIdx).join('\n');
    }

    // 2. Remove broken trailing imports at EOF (e.g. "import" or "import {")
    cleaned = cleaned.replace(/\n\s*import\s*\{?[^;\n]*$/i, '');

    // 3. Deduplicate consecutive repeated import lines
    const lines = cleaned.split('\n');
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ') && seen.has(trimmed)) {
        continue;
      }
      if (trimmed.startsWith('import ')) {
        seen.add(trimmed);
      }
      deduplicated.push(line);
    }
    cleaned = deduplicated.join('\n');

    // 4. Convert react-router-dom to next/link
    cleaned = cleaned.replace(/import\s*\{\s*Link\s*\}\s*from\s*['"]react-router-dom['"];?/g, "import Link from 'next/link';");
    cleaned = cleaned.replace(/<Link\s+to=/g, '<Link href=');

    return cleaned.trim();
  }

  private getDependencies(): string[] {
    return [
      'next@14.0.4',
      'react@^18',
      'react-dom@^18',
      'framer-motion@^10.16.16',
      'lucide-react@^0.303.0',
      'react-icons@^5.0.0',
      'clsx@^2.1.0',
      'tailwind-merge@^2.2.0',
      'typescript@^5',
    ];
  }
}
