import { AgentOrchestrator } from '../orchestrator';
import { ScrapedData } from '../scraper';

export interface WebsiteAnalysis {
  siteType: string;
  brandName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  headingFont: string;
  sections: AnalyzedSection[];
  navigationStyle: string;
  overallStyle: string;
  colorScheme: string;
  layout: string;
  keyFeatures: string[];
  heroContent: HeroContent;
  componentList: string[];
}

export interface AnalyzedSection {
  name: string;
  type: string;
  order: number;
  description: string;
  content: string;
  hasImages: boolean;
  hasCTA: boolean;
  layout: string;
}

export interface HeroContent {
  headline: string;
  subheadline: string;
  ctaText: string;
  ctaSecondary: string;
  hasVideo: boolean;
  hasImage: boolean;
  style: string;
}

export class WebsiteAnalyzer {
  private orchestrator: AgentOrchestrator;

  constructor(_apiKey?: string, _hfApiKey?: string) {
    this.orchestrator = new AgentOrchestrator({
      maxRetries: 3,
    });
  }

  async analyze(scraped: ScrapedData): Promise<WebsiteAnalysis> {
    console.log('[Analyzer] 🔍 Analyzing website structure & design from scraped data (Local Qwen2.5)...');

    const systemPrompt = `You are an expert UI/UX analyst and frontend developer. Analyze websites and extract structured information for frontend recreation. Always respond with valid JSON matching the exact schema requested. Return ONLY raw JSON, no markdown fences.`;
    const prompt = this.buildAnalysisPrompt(scraped);

    // Pass rich scraped data to local model without screenshot image to maximize context window
    const result = await this.orchestrator.rebuild(prompt, systemPrompt, 'Website Analysis (Scraped Data)');

    console.log(`[Analyzer] 🤖 Analysis via ${result.modelUsed} (${result.latencyMs}ms)`);
    if (result.fallbackReason) {
      console.log(`[Analyzer] ⚠️ Fallback reason: ${result.fallbackReason}`);
    }

    try {
      const cleaned = result.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const analysis = JSON.parse(cleaned) as WebsiteAnalysis;
      console.log('[Analyzer] ✅ Analysis complete:', analysis.siteType, '-', analysis.brandName);
      return analysis;
    } catch (e) {
      console.error('[Analyzer] Failed to parse analysis, using fallback');
      return this.buildFallbackAnalysis(scraped);
    }
  }

  private buildAnalysisPrompt(scraped: ScrapedData): string {
    return `Analyze the extracted website data below to plan frontend recreation. Return a comprehensive JSON analysis.

## Extracted Website Data:
- URL: ${scraped.url}
- Title: ${scraped.title}
- Description: ${scraped.metadata.description}
- OG Title: ${scraped.metadata.ogTitle}
- Theme Color: ${scraped.metadata.themeColor}

## Detected Colors (top 15):
${scraped.colors.slice(0, 15).join(', ')}

## Detected Fonts:
${scraped.fonts.slice(0, 10).join(', ')}

## Navigation Links:
${scraped.navigation.links.map(l => `${l.text}: ${l.href}`).join('\n')}
Brand: ${scraped.navigation.brand}

## Page Sections Found:
${scraped.sections.map(s => `- ${s.tag}[${s.classes.substring(0, 80)}]: ${s.text.substring(0, 100)}`).join('\n')}

## Accessibility Tree (Semantic Interactive Hierarchy):
${this.formatAxTreeSummary(scraped.axTree).slice(0, 1800)}

## Compressed Component Boundaries & Coordinates (DOM Reduced by ${scraped.domReduction?.reductionPercentage || 90}%):
${this.formatLayoutSummary(scraped.compressedLayout)}

## CSS Styles (excerpt):
${scraped.styles.slice(0, 3).join('\n').substring(0, 800)}

## Return this EXACT JSON schema:
{
  "siteType": "landing page|portfolio|ecommerce|blog|corporate|saas|restaurant|etc",
  "brandName": "actual brand/company name",
  "primaryColor": "#hexcolor - main brand color",
  "secondaryColor": "#hexcolor - secondary brand color",
  "accentColor": "#hexcolor - accent/highlight color",
  "backgroundColor": "#hexcolor - main background",
  "textColor": "#hexcolor - main text color",
  "fontFamily": "font name for body text",
  "headingFont": "font name for headings",
  "colorScheme": "light|dark|colorful|minimal|vibrant|muted",
  "overallStyle": "describe the visual style in 2-3 words",
  "navigationStyle": "horizontal|vertical|hamburger|fixed|transparent|solid",
  "layout": "full-width|contained|grid|asymmetric",
  "keyFeatures": ["list", "of", "key", "features", "to", "implement"],
  "componentList": ["Navbar", "Hero", "Features", "Pricing", "Footer", "etc"],
  "heroContent": {
    "headline": "actual headline text from the site",
    "subheadline": "actual subheadline/description text",
    "ctaText": "primary CTA button text",
    "ctaSecondary": "secondary CTA button text if any",
    "hasVideo": false,
    "hasImage": true,
    "style": "centered|left-aligned|split|fullscreen"
  },
  "sections": [
    {
      "name": "section identifier",
      "type": "hero|navbar|features|pricing|testimonials|team|contact|footer|gallery|about|faq|cta|stats|blog|clients",
      "order": 1,
      "description": "detailed description of this section's purpose and content",
      "content": "key text/content to include",
      "hasImages": true,
      "hasCTA": false,
      "layout": "grid|flex|single-column|two-column|three-column|cards|list"
    }
  ]
}`;
  }

  private buildFallbackAnalysis(scraped: ScrapedData): WebsiteAnalysis {
    return {
      siteType: 'landing page',
      brandName: scraped.title || scraped.navigation.brand || 'Website',
      primaryColor: scraped.metadata.themeColor || '#2563eb',
      secondaryColor: '#1e40af',
      accentColor: '#f59e0b',
      backgroundColor: '#ffffff',
      textColor: '#1f2937',
      fontFamily: 'Inter',
      headingFont: 'Inter',
      colorScheme: 'light',
      overallStyle: 'modern clean',
      navigationStyle: 'horizontal',
      layout: 'full-width',
      keyFeatures: ['responsive', 'modern design', 'clean layout'],
      componentList: ['Navbar', 'Hero', 'Features', 'CTA', 'Footer'],
      heroContent: {
        headline: scraped.navigation.brand || scraped.title,
        subheadline: scraped.metadata.description || 'Welcome to our website',
        ctaText: 'Get Started',
        ctaSecondary: 'Learn More',
        hasVideo: false,
        hasImage: scraped.images.length > 0,
        style: 'centered',
      },
      sections: [
        { name: 'navbar', type: 'navbar', order: 1, description: 'Navigation bar', content: scraped.navigation.links.map(l => l.text).join(', '), hasImages: false, hasCTA: false, layout: 'flex' },
        { name: 'hero', type: 'hero', order: 2, description: 'Hero section', content: scraped.textContent.substring(0, 200), hasImages: scraped.images.length > 0, hasCTA: true, layout: 'centered' },
        { name: 'footer', type: 'footer', order: 99, description: 'Footer section', content: '', hasImages: false, hasCTA: false, layout: 'flex' },
      ],
    };
  }

  private formatAxTreeSummary(node: any, depth: number = 0): string {
    if (!node || depth > 5) return '';
    const indent = '  '.repeat(depth);
    const role = node.role || '';
    const name = node.name ? ` "${node.name.slice(0, 50)}"` : '';
    let result = `${indent}- ${role}${name}\n`;
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children.slice(0, 10)) {
        result += this.formatAxTreeSummary(child, depth + 1);
      }
    }
    return result;
  }

  private formatLayoutSummary(nodes: any[]): string {
    if (!nodes || !Array.isArray(nodes)) return '';
    return nodes
      .slice(0, 25)
      .map(n => `- <${n.tag}> role=${n.role || 'none'} aria="${n.ariaLabel || ''}" box=[${n.box?.x ?? 0},${n.box?.y ?? 0},${n.box?.w ?? 0}x${n.box?.h ?? 0}] text="${(n.text || '').slice(0, 60)}"`)
      .join('\n');
  }
}

