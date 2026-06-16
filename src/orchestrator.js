import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, resolveConfigPath } from './lib/config.js';
import { scanDocTypes } from './doc-type-registry.js';
import { LlmClient } from './lib/llm.js';
import { statusFromErrors } from './lib/error-reporter.js';
import { projectRoot } from './lib/paths.js';

async function loadComponent(componentPath) {
  const module = await import(`${pathToFileURL(componentPath).href}?t=${Date.now()}`);
  return module;
}

function makeDocId(document) {
  const base = path.basename(document.name, path.extname(document.name));
  const safe = base.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'document';
  return `${safe}_${Date.now()}`;
}

async function saveDebug(context, artifacts) {
  if (!context.config.debug?.enabled) return;
  const debugDir = resolveConfigPath(context.config, './debug');
  const docDebugDir = path.join(debugDir, context.document.id);
  await fs.mkdir(docDebugDir, { recursive: true });

  if (context.config.debug.saveRenderedPrompts) {
    if (artifacts.universalPrompt) {
      await fs.writeFile(path.join(docDebugDir, 'universal.prompt.md'), artifacts.universalPrompt);
    }
    if (artifacts.specificPrompt) {
      await fs.writeFile(path.join(docDebugDir, 'specific.prompt.md'), artifacts.specificPrompt);
    }
  }

  if (context.config.debug.saveModelResponses) {
    if (artifacts.llmUniversalText) {
      await fs.writeFile(path.join(docDebugDir, 'universal.response.json'), JSON.stringify({
        text: artifacts.llmUniversalText,
        raw: artifacts.llmUniversalRaw
      }, null, 2));
    }
    if (artifacts.llmSpecificText) {
      await fs.writeFile(path.join(docDebugDir, 'specific.response.json'), JSON.stringify({
        text: artifacts.llmSpecificText,
        raw: artifacts.llmSpecificRaw
      }, null, 2));
    }
  }

  if (context.config.debug.saveArtifacts && artifacts.finalDocument) {
    await fs.writeFile(path.join(docDebugDir, 'output.json'), JSON.stringify(artifacts.finalDocument, null, 2));
  }
}

export async function runPipeline(options = {}) {
  const config = await loadConfig(options.config || 'config/config.jsonc');
  const docTypes = await scanDocTypes(config);
  const paths = {
    input: resolveConfigPath(config, config.paths.input),
    staging: resolveConfigPath(config, config.paths.staging),
    output: resolveConfigPath(config, config.paths.output),
    debug: resolveConfigPath(config, config.paths.debug)
  };

  const llm = new LlmClient(config);
  const componentDir = resolveConfigPath(config, config.components.dir || './src/components');
  const componentModules = {};
  const entries = await fs.readdir(componentDir, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.js'))) {
    const module = await loadComponent(path.join(componentDir, entry.name));
    if (module.meta?.id) componentModules[module.meta.id] = module;
  }

  const discovered = await componentModules['discover-documents'].run({ config, paths, artifacts: {} });
  if (!discovered.ok) throw discovered.error;

  const documents = discovered.artifacts.documents;
  const results = [];
  const counters = { output: 1 };

  for (const document of documents) {
    const context = {
      config,
      paths,
      docTypes,
      document: { ...document, id: makeDocId(document) },
      artifacts: {},
      llm,
      counters,
      log: []
    };

    await fs.mkdir(path.join(paths.staging, context.document.id), { recursive: true });

    let session = null;
    if ((config.llm.imagePolicy || 'session') === 'session') {
      session = await llm.createSession();
      context.artifacts.llmSession = session;
    }

    const errors = [];
    for (const step of config.pipeline || []) {
      if (!step.enabled) continue;
      const component = componentModules[step.component];
      if (!component) {
        throw new Error(`Component not found: ${step.component}`);
      }
      try {
        const result = await component.run(context);
        if (!result.ok) {
          errors.push(result.error);
          if (step.required) break;
        } else {
          Object.assign(context.artifacts, result.artifacts || {});
        }
      } catch (error) {
        errors.push({
          code: error.code || 'COMPONENT_ERROR',
          message: error.message,
          stage: step.id,
          recoverable: false,
          suggestions: ['inspect debug output']
        });
        if (step.required) break;
      }
    }

    if (session) {
      await llm.closeSession(session);
    }

    const status = context.artifacts.finalDocument?.status || statusFromErrors(errors);
    const result = {
      docId: context.document.id,
      status,
      errors,
      outputPath: context.artifacts.outputPath || null
    };
    results.push(result);

    await saveDebug(context, context.artifacts);

    if (errors.some((error) => !error.recoverable)) {
      process.exitCode = 1;
    }
  }

  return results;
}

export async function dryRun(options = {}) {
  const config = await loadConfig(options.config || 'config/config.jsonc');
  const docTypes = await scanDocTypes(config);
  const universalPrompt = await import('./prompt-builder.js').then((module) => module.buildUniversalPrompt(config, docTypes));
  console.log(JSON.stringify({
    ok: true,
    docTypes: docTypes.map((item) => ({ type: item.type, name: item.name })),
    universalPrompt
  }, null, 2));
}

export async function renderPrompt(options = {}) {
  const config = await loadConfig(options.config || 'config/config.jsonc');
  const docTypes = await scanDocTypes(config);
  const { buildSpecificPrompt, buildUnknownPrompt } = await import('./prompt-builder.js');
  const docType = options.docType ? docTypes.find((item) => item.type === options.docType) : null;
  const previousResult = options.previousResult || { docType: docType?.type || 'unknown', confidence: 0.9, fields: {} };
  const prompt = docType
    ? await buildSpecificPrompt(config, docType, previousResult)
    : await buildUnknownPrompt(config, previousResult);
  console.log(prompt);
}

export async function configDoctor(options = {}) {
  const config = await loadConfig(options.config || 'config/config.jsonc');
  const docTypes = await scanDocTypes(config);
  const errors = [];
  const seen = new Set();

  for (const docType of docTypes) {
    if (seen.has(docType.type)) errors.push(`Duplicate type: ${docType.type}`);
    seen.add(docType.type);
    if (!docType.name) errors.push(`${docType.type}: missing name`);
    if (!Array.isArray(docType.firstPassFields)) errors.push(`${docType.type}: missing firstPassFields`);
    if (!docType.crmNaming?.template) errors.push(`${docType.type}: missing crmNaming.template`);
  }

  if (config.processing?.concurrency !== 1) {
    errors.push('processing.concurrency must be 1');
  }

  console.log(JSON.stringify({
    ok: errors.length === 0,
    errors,
    docTypes: docTypes.map((item) => item.type)
  }, null, 2));
  if (errors.length) process.exitCode = 1;
}
