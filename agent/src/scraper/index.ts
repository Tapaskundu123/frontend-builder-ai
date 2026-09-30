import { chromium, Browser, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs-extra';

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompressedLayoutNode {
  tag: string;
  role?: string;
  ariaLabel?: string;
  box: BoundingBox;
  text?: string;
  style?: {
    bg?: string;
    color?: string;
    fontSize?: string;
  };
  children?: CompressedLayoutNode[];
}

export interface DomReductionStats {
  rawHtmlBytes: number;
  compressedBytes: number;
  reductionPercentage: number;
}

export interface DownsamplingInfo {
  originalWidth: number;
  originalHeight: number;
  downsampledWidth: number;
  downsampledHeight: number;
  maxWidth: number;
}

export interface ScrapedData {
  url: string;
  title: string;
  screenshot: string; // base64 (downsampled to max width 1080px)
  html: string;
  compressedLayout: CompressedLayoutNode[];
  axTree: any; // Accessibility Tree from Playwright
  domReduction: DomReductionStats;
  downsampling: DownsamplingInfo;
  styles: string[];
  fonts: string[];
  colors: string[];
  sections: SectionInfo[];
  navigation: NavInfo;
  images: ImageInfo[];
  textContent: string;
  metadata: MetaInfo;
  viewport: { width: number; height: number };
}

export interface SectionInfo {
  tag: string;
  role: string;
  text: string;
  classes: string;
  id: string;
  children: number;
}

export interface NavInfo {
  links: { text: string; href: string }[];
  logo: string;
  brand: string;
}

export interface ImageInfo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface MetaInfo {
  description: string;
  keywords: string;
  ogTitle: string;
  ogImage: string;
  themeColor: string;
}

export class WebScraper {
  private browser: Browser | null = null;

  async scrape(url: string): Promise<ScrapedData> {
    console.log(`[Scraper] Starting scrape of: ${url}`);
    
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await this.browser.newPage();
    
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      
      // Navigate with generous timeout
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      // Wait for web fonts to load
      try {
        await page.evaluate(() => document.fonts.ready);
      } catch (_) {}

      // Scroll smoothly down the page to trigger all lazy-loaded elements & animations
      await this.autoScroll(page);

      // Scroll back to top for clean full-page capture
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(800);

      // Take high quality full-page screenshot
      const rawScreenshotBuffer = await page.screenshot({ 
        fullPage: true,
        type: 'jpeg',
        quality: 90
      });
      const rawScreenshot = rawScreenshotBuffer.toString('base64');
      console.log(`[Scraper] 📸 Captured full-page UI screenshot via Playwright (${Math.round(rawScreenshotBuffer.length / 1024)} KB)`);

      // ── Dynamic Resolution Downsampling (Max 1080px Width) ──
      console.log('[Scraper] 🖼️ Applying Dynamic Resolution Downsampling (Max width: 1080px) to prevent visual token bloat...');
      const downsampleResult = await this.downsampleScreenshot(page, rawScreenshot, 1080);
      const screenshot = downsampleResult.base64;
      const downsampling: DownsamplingInfo = {
        originalWidth: downsampleResult.originalWidth,
        originalHeight: downsampleResult.originalHeight,
        downsampledWidth: downsampleResult.newWidth,
        downsampledHeight: downsampleResult.newHeight,
        maxWidth: 1080,
      };
      console.log(`[Scraper] 📉 Dynamic Resolution Downsampling complete: ${downsampleResult.originalWidth}x${downsampleResult.originalHeight} → ${downsampleResult.newWidth}x${downsampleResult.newHeight} (Max width: 1080px)`);

      // ── DOM Reduction Middleware: Extract AX Tree & Compressed Layout ──
      console.log('[Scraper] ⚡ Running DOM Reduction Middleware: Extracting AX Tree & Component Boundaries...');
      const [axTree, compressedLayout, rawHtml] = await Promise.all([
        this.extractAxTree(page),
        this.extractCompressedLayout(page),
        page.content(),
      ]);

      const rawHtmlBytes = Buffer.byteLength(rawHtml, 'utf-8');
      const compressedPayload = JSON.stringify({ layout: compressedLayout, axTree });
      const compressedBytes = Buffer.byteLength(compressedPayload, 'utf-8');
      const reductionPercentage = rawHtmlBytes > 0 
        ? Math.round(((rawHtmlBytes - compressedBytes) / rawHtmlBytes) * 1000) / 10 
        : 0;

      console.log(`[Scraper] 📉 DOM Reduction: ${Math.round(rawHtmlBytes / 1024)} KB raw HTML → ${Math.round(compressedBytes / 1024)} KB clean AX layout (${reductionPercentage}% context reduction)`);

      const domReduction: DomReductionStats = {
        rawHtmlBytes,
        compressedBytes,
        reductionPercentage,
      };

      // Extract remaining structured data in parallel
      const [title, styles, fonts, colors, sections, navigation, images, metadata, textContent] = await Promise.all([
        page.title(),
        this.extractStyles(page),
        this.extractFonts(page),
        this.extractColors(page),
        this.extractSections(page),
        this.extractNavigation(page),
        this.extractImages(page),
        this.extractMetadata(page),
        this.extractTextContent(page),
      ]);

      console.log(`[Scraper] Successfully scraped: ${title}`);

      return {
        url,
        title,
        screenshot,
        html: rawHtml.slice(0, 5000), // Trim raw HTML to avoid bloating memory/context
        compressedLayout,
        axTree,
        domReduction,
        downsampling,
        styles,
        fonts,
        colors,
        sections,
        navigation,
        images,
        textContent,
        metadata,
        viewport: { width: 1440, height: 900 },
      };
    } finally {
      await page.close();
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Extract Accessibility Tree (AX Tree) via CDP or fallback
   */
  private async extractAxTree(page: Page): Promise<any> {
    try {
      const client = await page.context().newCDPSession(page);
      const res = await client.send('Accessibility.getFullAXTree');
      return res.nodes ? res.nodes.slice(0, 100) : [];
    } catch (_) {
      try {
        if (typeof (page as any).accessibility?.snapshot === 'function') {
          return await (page as any).accessibility.snapshot({ interestingOnly: true });
        }
      } catch (_) {}
      return [];
    }
  }

  /**
   * Pre-processing Middleware: Extracts a compact JSON layout with coordinates,
   * component boundaries, semantic roles, and aria-labels, stripping away noisy wrapper divs.
   */
  private async extractCompressedLayout(page: Page): Promise<CompressedLayoutNode[]> {
    return page.evaluate(() => {
      const IGNORED_TAGS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'PATH', 'LINK', 'META', 'HEAD', 'BR', 'HR'
      ]);

      const SEMANTIC_ROLES = new Set([
        'banner', 'navigation', 'main', 'complementary', 'contentinfo',
        'heading', 'button', 'link', 'article', 'section', 'form',
        'search', 'region', 'dialog', 'list', 'listitem', 'tab', 'tabpanel', 'toolbar'
      ]);

      const SEMANTIC_TAGS = new Set([
        'HEADER', 'NAV', 'MAIN', 'SECTION', 'ARTICLE', 'ASIDE', 'FOOTER',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BUTTON', 'A', 'FORM', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'P'
      ]);

      function isVisible(el: HTMLElement, rect: DOMRect): boolean {
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
          return false;
        }
        return true;
      }

      function processElement(el: HTMLElement, depth: number = 0): CompressedLayoutNode | null {
        if (depth > 7) return null; // Prevent deep nesting traps
        const tagName = el.tagName.toUpperCase();
        if (IGNORED_TAGS.has(tagName)) return null;

        const rect = el.getBoundingClientRect();
        if (!isVisible(el, rect)) return null;

        const role = el.getAttribute('role') || undefined;
        const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || undefined;
        const isSemantic = SEMANTIC_TAGS.has(tagName) || (role && SEMANTIC_ROLES.has(role)) || !!ariaLabel;

        // Extract direct text on this element
        let directText = '';
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            directText += (child.textContent || '').trim() + ' ';
          }
        }
        directText = directText.trim().slice(0, 120);

        // Process children
        const childNodes: CompressedLayoutNode[] = [];
        for (const child of Array.from(el.children)) {
          if (child instanceof HTMLElement) {
            const processed = processElement(child, depth + 1);
            if (processed) childNodes.push(processed);
          }
        }

        // If it's a generic div with no text, no semantic role, and no children, discard
        if (!isSemantic && !directText && childNodes.length === 0) {
          return null;
        }

        // Collapse single non-semantic wrapper divs
        if (!isSemantic && !directText && childNodes.length === 1) {
          return childNodes[0];
        }

        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : undefined;
        const color = cs.color !== 'rgba(0, 0, 0, 0)' ? cs.color : undefined;
        const fontSize = cs.fontSize;

        return {
          tag: tagName,
          role: role || undefined,
          ariaLabel: ariaLabel || undefined,
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
          text: directText || undefined,
          style: (bg || color) ? { bg, color, fontSize } : undefined,
          children: childNodes.length > 0 ? childNodes : undefined,
        };
      }

      const root = document.body;
      if (!root) return [];
      const processedRoot = processElement(root);
      return processedRoot?.children || (processedRoot ? [processedRoot] : []);
    });
  }

  private async extractStyles(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const styles: string[] = [];
      
      // Inline styles
      document.querySelectorAll('style').forEach(style => {
        if (style.textContent) styles.push(style.textContent.substring(0, 5000));
      });
      
      // Link stylesheets hrefs
      document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        const href = (link as HTMLLinkElement).href;
        if (href) styles.push(`/* External: ${href} */`);
      });

      // Computed styles for key elements
      const keyElements = ['body', 'header', 'nav', 'main', 'footer', 'h1', 'h2', 'p', 'a', 'button'];
      keyElements.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) {
          const cs = window.getComputedStyle(el);
          styles.push(`/* ${sel} computed: font-family:${cs.fontFamily}; font-size:${cs.fontSize}; color:${cs.color}; background:${cs.backgroundColor}; */`);
        }
      });

      return styles;
    });
  }

  private async extractFonts(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const fonts = new Set<string>();
      
      document.querySelectorAll('*').forEach(el => {
        const ff = window.getComputedStyle(el).fontFamily;
        if (ff) ff.split(',').forEach(f => fonts.add(f.trim().replace(/['"]/g, '')));
      });
      
      // Also check @font-face in stylesheets
      Array.from(document.styleSheets).forEach(sheet => {
        try {
          Array.from(sheet.cssRules || []).forEach(rule => {
            if (rule instanceof CSSFontFaceRule) {
              const src = rule.style.getPropertyValue('src');
              fonts.add(`FontFace: ${src.substring(0, 100)}`);
            }
          });
        } catch { /* cross-origin */ }
      });

      return Array.from(fonts).slice(0, 20);
    });
  }

  private async extractColors(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const colors = new Set<string>();
      
      document.querySelectorAll('*').forEach(el => {
        const cs = window.getComputedStyle(el);
        const props = ['color', 'backgroundColor', 'borderColor', 'outlineColor'];
        props.forEach(prop => {
          const val = cs.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase());
          if (val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent' && val !== '') {
            colors.add(val);
          }
        });
      });

      return Array.from(colors).slice(0, 30);
    });
  }

  private async extractSections(page: Page): Promise<SectionInfo[]> {
    return page.evaluate(() => {
      const sections: SectionInfo[] = [];
      const selectors = ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', '[role="banner"]', '[role="navigation"]', '[role="main"]', '[role="contentinfo"]'];
      
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          sections.push({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || '',
            text: el.textContent?.substring(0, 200) || '',
            classes: el.className || '',
            id: el.id || '',
            children: el.children.length,
          });
        });
      });

      return sections;
    });
  }

  private async extractNavigation(page: Page): Promise<NavInfo> {
    return page.evaluate(() => {
      const links: { text: string; href: string }[] = [];
      
      // Try to find nav links
      const navEl = document.querySelector('nav, [role="navigation"], header');
      if (navEl) {
        navEl.querySelectorAll('a').forEach(a => {
          const text = a.textContent?.trim();
          const href = a.getAttribute('href');
          if (text && href && !href.startsWith('#') && !href.startsWith('javascript')) {
            links.push({ text: text.substring(0, 30), href });
          }
        });
      }

      // Brand / logo
      let brand = '';
      const brandEl = document.querySelector('[class*="brand"], [class*="logo"], a[href="/"], a.navbar-brand');
      if (brandEl) {
        brand = brandEl.textContent?.trim() || '';
      }

      let logo = '';
      const logoImg = document.querySelector('nav img, [class*="logo"] img, header img');
      if (logoImg) {
        logo = (logoImg as HTMLImageElement).src || '';
      }

      return { links: links.slice(0, 10), logo, brand };
    });
  }

  private async extractImages(page: Page): Promise<ImageInfo[]> {
    return page.evaluate(() => {
      const images: ImageInfo[] = [];
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.getAttribute('data-src') || '';
        if (src && !src.startsWith('data:')) {
          images.push({
            src,
            alt: img.alt || '',
            width: img.naturalWidth || img.width || 0,
            height: img.naturalHeight || img.height || 0,
          });
        }
      });
      return images.slice(0, 20);
    });
  }

  private async extractMetadata(page: Page): Promise<MetaInfo> {
    return page.evaluate(() => {
      const getMeta = (name: string) => 
        (document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement)?.content || '';
      const getOg = (prop: string) => 
        (document.querySelector(`meta[property="og:${prop}"]`) as HTMLMetaElement)?.content || '';

      return {
        description: getMeta('description'),
        keywords: getMeta('keywords'),
        ogTitle: getOg('title'),
        ogImage: getOg('image'),
        themeColor: getMeta('theme-color'),
      };
    });
  }

  private async extractTextContent(page: Page): Promise<string> {
    return page.evaluate(() => {
      const parts: string[] = [];
      
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      headings.forEach(h => {
        parts.push(`[${h.tagName}] ${h.textContent?.trim()}`);
      });

      const paragraphs = document.querySelectorAll('p');
      paragraphs.forEach(p => {
        const text = p.textContent?.trim() || '';
        if (text.length > 20) parts.push(`[P] ${text.substring(0, 200)}`);
      });

      const buttons = document.querySelectorAll('button, [class*="btn"], [class*="button"]');
      buttons.forEach(btn => {
        const text = btn.textContent?.trim() || '';
        if (text) parts.push(`[BTN] ${text}`);
      });

      return parts.slice(0, 100).join('\n');
    });
  }

  private async autoScroll(page: Page): Promise<void> {
    try {
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 400;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight || totalHeight >= 6000) {
              clearInterval(timer);
              resolve();
            }
          }, 120);
        });
      });
    } catch (_) {}
  }

  /**
   * Dynamic Resolution Downsampling:
   * High-resolution screenshots spike visual token math exponentially.
   * Scales screenshots down to a maximum width of 1080px before passing to the vision model.
   */
  private async downsampleScreenshot(
    page: Page,
    base64Screenshot: string,
    maxWidth: number = 1080,
    maxHeight: number = 1920
  ): Promise<{ base64: string; originalWidth: number; newWidth: number; originalHeight: number; newHeight: number }> {
    return page.evaluate(
      async ({ base64, maxW, maxH }) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const originalWidth = img.naturalWidth || img.width;
            const originalHeight = img.naturalHeight || img.height;

            if (originalWidth <= maxW && originalHeight <= maxH) {
              resolve({
                base64,
                originalWidth,
                newWidth: originalWidth,
                originalHeight,
                newHeight: originalHeight,
              });
              return;
            }

            const scale = Math.min(maxW / originalWidth, maxH / originalHeight);
            const newWidth = Math.max(Math.round(originalWidth * scale), 320);
            const newHeight = Math.max(Math.round(originalHeight * scale), 320);

            const canvas = document.createElement('canvas');
            canvas.width = newWidth;
            canvas.height = newHeight;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
              resolve({
                base64,
                originalWidth,
                newWidth: originalWidth,
                originalHeight,
                newHeight: originalHeight,
              });
              return;
            }

            // High-quality bicubic smoothing
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, newWidth, newHeight);

            const downsampledDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            const downsampledBase64 = downsampledDataUrl.replace(/^data:image\/jpeg;base64,/, '');

            resolve({
              base64: downsampledBase64,
              originalWidth,
              newWidth,
              originalHeight,
              newHeight,
            });
          };

          img.onerror = () => {
            resolve({
              base64,
              originalWidth: 1440,
              newWidth: 1440,
              originalHeight: 900,
              newHeight: 900,
            });
          };

          img.src = `data:image/jpeg;base64,${base64}`;
        });
      },
      { base64: base64Screenshot, maxW: maxWidth, maxH: maxHeight }
    );
  }
}
