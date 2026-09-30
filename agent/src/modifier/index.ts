/**
 * CodeModifier — Agentic Modification Engine
 * ────────────────────────────────────────────────────────────────────
 * Powered 100% locally by Qwen2.5-VL-3B (Ollama / RTX GPU).
 * Zero cloud API keys required.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { AgentOrchestrator } from '../orchestrator';

export interface ModificationResult {
  success: boolean;
  modifiedFiles: string[];
  description: string;
  error?: string;
  modelUsed?: string;
}

export class CodeModifier {
  private orchestrator: AgentOrchestrator;

  constructor(_apiKey?: string, _hfApiKey?: string) {
    this.orchestrator = new AgentOrchestrator({
      maxRetries: 3,
    });
  }

  async modify(
    projectPath: string,
    instruction: string,
    onProgress?: (msg: string) => void
  ): Promise<ModificationResult> {
    const progress = onProgress || console.log;
    progress(`[Modifier] 🧠 Routing modification to Local Qwen2.5-VL-3B...`);

    try {
      const projectContext = await this.readProjectContext(projectPath);
      const plan = await this.planModification(instruction, projectContext, progress);

      progress(`[Modifier] Plan: ${plan.description}`);
      progress(`[Modifier] Files to modify: ${plan.filesToModify.join(', ')}`);

      const modifiedFiles: string[] = [];
      let lastModel = 'qwen2.5vl:3b';

      for (const fileToModify of plan.filesToModify) {
        const filePath = path.join(projectPath, fileToModify);
        if (!(await fs.pathExists(filePath))) {
          progress(`[Modifier] File not found: ${fileToModify}, skipping...`);
          continue;
        }
        const currentContent = await fs.readFile(filePath, 'utf-8');
        progress(`[Modifier] Modifying ${fileToModify}...`);
        const { content: newContent, modelUsed } = await this.applyModification(
          instruction, fileToModify, currentContent, plan.description, progress
        );
        lastModel = modelUsed;
        if (newContent && newContent !== currentContent) {
          await fs.writeFile(filePath, newContent, 'utf-8');
          modifiedFiles.push(fileToModify);
          progress(`[Modifier] ✅ Updated ${fileToModify} via ${modelUsed}`);
        }
      }

      if (plan.newFiles && plan.newFiles.length > 0) {
        for (const newFile of plan.newFiles) {
          progress(`[Modifier] Creating new file: ${newFile.path}`);
          const filePath = path.join(projectPath, newFile.path);
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeFile(filePath, newFile.content, 'utf-8');
          modifiedFiles.push(newFile.path);
          await this.addComponentToPage(projectPath, newFile.path);
        }
      }

      if (modifiedFiles.length === 0) {
        return {
          success: false,
          modifiedFiles,
          description: plan.description,
          error: 'The requested change did not produce any file updates.',
          modelUsed: lastModel,
        };
      }

      return { success: true, modifiedFiles, description: plan.description, modelUsed: lastModel };
    } catch (error: any) {
      return { success: false, modifiedFiles: [], description: 'Failed to apply modification', error: error.message };
    }
  }

  async fixBuildErrors(
    projectPath: string,
    errorLog: string,
    onProgress?: (msg: string) => void
  ): Promise<{ success: boolean; fixedFiles: string[]; explanation: string }> {
    const progress = onProgress || console.log;
    progress(`[Auto-Fix] 🔧 Analyzing build errors with Local Qwen2.5-VL-3B (repair)...`);

    try {
      const projectContext = await this.readProjectContext(projectPath);

      const prompt = `You are an expert Next.js and TypeScript auto-repair engineer.
The Next.js project failed to build with compilation/type errors:

## ERROR LOG:
${errorLog.slice(0, 4000)}

## PROJECT FILES:
${projectContext}

Fix all the errors. Common issues:
1. Missing "use client" directive for components using hooks/framer-motion.
2. Broken JSX syntax, unclosed tags, invalid attributes.
3. Import path errors or importing symbols that don't exist.
4. TypeScript type mismatches.
5. Missing "export default" in page/component files.

Respond in JSON format:
{
  "explanation": "Summary of what caused the errors and what you fixed",
  "fixes": [
    {
      "filePath": "relative path to file (e.g. components/Pricing.tsx)",
      "fixedContent": "complete corrected source code"
    }
  ]
}`;

      const result = await this.orchestrator.rebuild(
        prompt,
        'You are an expert Next.js debugger. Return valid JSON containing the exact fixed file contents.',
        'Build Error Repair'
      );

      progress(`[Auto-Fix] 🤖 Received response from ${result.modelUsed}`);

      const parsed = this.parseFixesResponse(result.text);

      if (parsed.fixes && Array.isArray(parsed.fixes) && parsed.fixes.length > 0) {
        const fixedFiles: string[] = [];
        for (const fix of parsed.fixes) {
          if (!fix.filePath || !fix.fixedContent) continue;
          const targetPath = path.join(projectPath, fix.filePath);
          const cleanedCode = this.cleanCode(fix.fixedContent);
          await fs.ensureDir(path.dirname(targetPath));
          await fs.writeFile(targetPath, cleanedCode, 'utf-8');
          fixedFiles.push(fix.filePath);
          progress(`[Auto-Fix] 🛠️ Patched: ${fix.filePath}`);
        }

        const explanation = parsed.explanation || `Repaired ${fixedFiles.length} file(s)`;
        progress(`[Auto-Fix] ✅ Applied fixes: ${explanation}`);
        return { success: true, fixedFiles, explanation };
      }

      // Fallback Strategy: Single-file targeted prompt for specific failing file
      const fileMatch = errorLog.match(/([a-zA-Z0-9_\-\.\/]+\.(?:tsx|ts))[\(:]\d+/i);
      if (fileMatch && fileMatch[1]) {
        const targetRelPath = fileMatch[1].replace(/^\.\//, '');
        const targetFullPath = path.join(projectPath, targetRelPath);

        if (await fs.pathExists(targetFullPath)) {
          progress(`[Auto-Fix] 🎯 Multi-file JSON missing. Triggering targeted single-file repair for ${targetRelPath}...`);
          const fileContent = await fs.readFile(targetFullPath, 'utf-8');

          const singleFilePrompt = `Fix the TypeScript/Next.js error in ${targetRelPath}.
Error details:
${errorLog.slice(0, 1500)}

Existing File Content:
\`\`\`tsx
${fileContent}
\`\`\`

Return ONLY the complete corrected TSX code for ${targetRelPath} inside a single \`\`\`tsx block.`;

          const singleResult = await this.orchestrator.rebuild(
            singleFilePrompt,
            'You are an expert TypeScript debugger. Return ONLY the complete fixed file code in a ```tsx block.',
            `Targeted Repair (${targetRelPath})`
          );

          const codeMatch = singleResult.text.match(/```(?:tsx|ts)?\s*\n([\s\S]*?)```/i);
          const fixedCode = codeMatch ? codeMatch[1].trim() : singleResult.text.trim();

          if (fixedCode && fixedCode !== fileContent) {
            const cleaned = this.cleanCode(fixedCode);
            await fs.writeFile(targetFullPath, cleaned, 'utf-8');
            progress(`[Auto-Fix] 🛠️ Targeted single-file patch applied to ${targetRelPath}`);
            return { success: true, fixedFiles: [targetRelPath], explanation: `Targeted repair applied to ${targetRelPath}` };
          }
        }
      }

      return { success: false, fixedFiles: [], explanation: 'No fixes identified' };
    } catch (err: any) {
      progress(`[Auto-Fix] ❌ Auto-fix error: ${err.message}`);
      return { success: false, fixedFiles: [], explanation: err.message };
    }
  }

  private parseFixesResponse(text: string): { explanation?: string; fixes?: Array<{ filePath: string; fixedContent: string }> } {
    try {
      return JSON.parse(text);
    } catch {}

    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      return JSON.parse(cleaned);
    } catch {}

    try {
      const jsonMatch = text.match(/\{[\s\S]*"fixes"[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {}

    const fixes: Array<{ filePath: string; fixedContent: string }> = [];
    const codeBlockRegex = /```(?:tsx|ts|jsx|js)?\s*\n?(?:\/\/|\/\*|#)?\s*(?:File:\s*)?([a-zA-Z0-9_\-\.\/]+\.(?:tsx|ts|js|jsx))\s*\n([\s\S]*?)```/gi;
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const filePath = match[1].trim();
      const fixedContent = match[2].trim();
      if (filePath && fixedContent) {
        fixes.push({ filePath, fixedContent });
      }
    }

    if (fixes.length > 0) {
      return { explanation: `Extracted ${fixes.length} file fix(es) from code blocks`, fixes };
    }

    return {};
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private async planModification(
    instruction: string,
    projectContext: string,
    progress: (msg: string) => void
  ): Promise<{ description: string; filesToModify: string[]; newFiles?: { path: string; content: string }[] }> {
    const result = await this.orchestrator.modify(
      `## User Instruction:
"${instruction}"

## Current Project Files:
${projectContext}

Return JSON:
{
  "description": "What you will do in 1-2 sentences",
  "filesToModify": ["list of existing file paths, e.g. app/globals.css, components/Navbar.tsx"],
  "newFiles": [{ "path": "components/NewComponent.tsx", "content": "complete TSX content" }]
}

Examples:
- "Change primary color to blue" → modify app/globals.css
- "Make navbar sticky" → modify components/Navbar.tsx
- "Add testimonials section" → create components/Testimonials.tsx
- "Remove pricing section" → modify app/page.tsx`,
      `You are an expert React/Next.js developer. Plan how to apply natural language modifications to a Next.js project. Return a JSON plan.`,
      'Plan Modification'
    );

    progress(`[Modifier] 🤖 Planning via ${result.modelUsed}`);

    try {
      const cleaned = result.text.replace(/^```json\n?/gm, '').replace(/```$/gm, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { description: instruction, filesToModify: ['app/globals.css'] };
    }
  }

  private async applyModification(
    instruction: string,
    filePath: string,
    currentContent: string,
    planDescription: string,
    progress: (msg: string) => void
  ): Promise<{ content: string; modelUsed: string }> {
    const ext = path.extname(filePath);
    const lang = ext === '.css' ? 'CSS' : 'React/Next.js TypeScript';

    const result = await this.orchestrator.modify(
      `## Modification Instruction: "${instruction}"
## What to change: ${planDescription}
## File: ${filePath}
## Current Content:
${currentContent}

Apply the modification and return the COMPLETE updated file content only.`,
      `You are an expert ${lang} developer applying targeted modifications.
Apply ONLY the requested change. Keep everything else identical.
Return ONLY the complete file content, no markdown fences, no explanations.`,
      `Modify ${path.basename(filePath)}`
    );

    return {
      content: this.cleanCode(result.text || currentContent),
      modelUsed: result.modelUsed,
    };
  }

  private async addComponentToPage(projectPath: string, componentFilePath: string): Promise<void> {
    const pagePath = path.join(projectPath, 'app', 'page.tsx');
    if (!(await fs.pathExists(pagePath))) return;
    const componentName = path.basename(componentFilePath, '.tsx');
    const currentContent = await fs.readFile(pagePath, 'utf-8');
    if (currentContent.includes(componentName)) return;

    const updated = currentContent
      .replace(/(import .+;\n)(?!import)/, `$1import ${componentName} from '@/components/${componentName}';\n`)
      .replace('    </main>', `      <${componentName} />\n    </main>`);

    await fs.writeFile(pagePath, updated, 'utf-8');
  }

  private async readProjectContext(projectPath: string): Promise<string> {
    const context: string[] = [];
    for (const dir of ['app', 'components']) {
      const dirPath = path.join(projectPath, dir);
      if (!(await fs.pathExists(dirPath))) continue;
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        if (['.tsx', '.ts', '.css'].includes(path.extname(file))) {
          const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
          context.push(`\n### ${dir}/${file}:\n${content.substring(0, 800)}...`);
        }
      }
    }
    return context.join('\n').substring(0, 6000);
  }

  private cleanCode(code: string): string {
    let cleaned = code.replace(/^```(?:tsx?|javascript|jsx?|css)?\n?/gm, '').replace(/```$/gm, '').trim();

    // Strip leading conversational preamble before the first real code statement
    const lines = cleaned.split('\n');
    let firstCodeIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
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
        firstCodeIndex = i;
        break;
      }
    }
    if (firstCodeIndex > 0) {
      cleaned = lines.slice(firstCodeIndex).join('\n');
    }

    return cleaned.trim();
  }
}
