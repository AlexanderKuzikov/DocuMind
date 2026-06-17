import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, resolveConfigPath } from './lib/config.js';
import { scanDocTypes, findDocType } from './doc-type-registry.js';
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

/**
 * Apply forceTemperature and disableThinking overrides from config.llm.
 * These settings take priority over profile-level values.
 */
function applyLlmOverrides(config) {
  if (config.llm.forceTemperature !== undefined && config.llm.forceTemperature !== null) {
    config.llm.temperature = config.llm.forceTemperature;
  }
  if (config.llm.disableThinking === true) {
    if (!config.llm.thinking) config.llm.thinking = {};
    config.llm.thinking.enabled = false;
  }
}

let pipelineExecution = Promise.resolve();

async function withPipelineLock(fn) {
  const previous = pipelineExecution;
  let release;
  pipelineExecution = new Promise((resolve) => {
    release = resolve;
  });

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
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
  return withPipelineLock(async () => {
    const config = await loadConfig(options.config || 'config/config.jsonc');
    applyLlmOverrides(config);

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

    // maxDocumentsPerRun: 0 or absent = no limit (process all)
    const maxDocs = config.processing?.maxDocumentsPerRun || 0;
    const documents = maxDocs > 0
      ? (discovered.artifacts.documents || []).slice(0, maxDocs)
      : (discovered.artifacts.documents || []);

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
      context.artifacts.document = context.document;

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

      if (result.outputPath) {
        counters.output += 1;
      }

      await saveDebug(context, context.artifacts);

      if (errors.some((error) => !error.recoverable)) {
        process.exitCode = 1;
      }
    }

    return results;
  });
}

export async function dryRun(options = {}) {
  const config = await loadConfig(options.config || 'config/config.jsonc');
  const docTypes = await scanDocTypes(config);
  const universalPrompt = await import('./prompt-builder.js').then((module) => module.buildUniversalPrompt(config, docTypes));
  const result = {
    ok: true,
    docTypes: docTypes.map((item) => ({ type: item.type, name: item.name })),
    universalPrompt
  };
  if (!options.silent) console.log(JSON.stringify(result, null, 2));
  return result;
}

export async function renderPrompt(options = {}) {
  const config = await loadConfig(options.config || 'config/config.jsonc');
  const docTypes = await scanDocTypes(config);
  const { buildSpecificPrompt, buildUnknownPrompt } = await import('./prompt-builder.js');
  const docType = options.docType ? findDocType(docTypes, options.docType) : null;
  const previousResult = options.previousResult || { docType: docType?.type || 'unknown', confidence: 0.9, fields: {} };
  const prompt = docType
    ? await buildSpecificPrompt(config, docType, previousResult)
    : await buildUnknownPrompt(config, previousResult);
  if (!options.silent) console.log(prompt);
  return prompt;
}

export async function configDoctor(options = {}) {
  const config = await loadConfig(options.config || 'config/config.jsonc');
  const docTypes = await scanDocTypes(config);
  const errors = [];
  const seen = new Set();
  const promptDir = resolveConfigPath(config, `${config.paths.prompts}/templates`);
  const componentDir = resolveConfigPath(config, config.components.dir || './src/components');
  const requiredPaths = [
    config.paths.input,
    config.paths.staging,
    config.paths.output,
    config.paths.debug,
    config.paths.docTypes,
    config.paths.prompts,
    config.components.dir || './src/components'
  ];

  for (const relativePath of requiredPaths) {
    const absolutePath = resolveConfigPath(config, relativePath);
    try {
      await fs.access(absolutePath);
    } catch (_) {
      errors.push(`Configured path does not exist: ${relativePath}`);
    }
  }

  for (const template of ['universal.md', 'specific.md', 'generic-unknown.md']) {
    try {
      await fs.access(path.join(promptDir, template));
    } catch (_) {
      errors.push(`Prompt template does not exist: ${template}`);
    }
  }

  try {
    await fs.access(componentDir);
  } catch (_) {
    errors.push(`Component directory does not exist: ${config.components.dir || './src/components'}`);
  }

  const activeProfile = config.llm?.profiles?.[config.llm.activeProfile];
  if (!activeProfile) {
    errors.push(`Unknown LLM activeProfile: ${config.llm?.activeProfile}`);
  }
  for (const [profileName, profile] of Object.entries(config.llm?.profiles || {})) {
    if (profile.imageEncoding && !['data-url', 'base64', 'base64-prefixed'].includes(profile.imageEncoding)) {
      errors.push(`llm.profiles.${profileName}.imageEncoding must be "data-url", "base64", or "base64-prefixed"`);
    }
  }

  if (config.processing?.allowParallelDocuments !== false) {
    errors.push('processing.allowParallelDocuments must be false');
  }

  if (config.processing?.allowParallelLlmCalls !== false) {
    errors.push('processing.allowParallelLlmCalls must be false');
  }

  if (![150, 200].includes(config.rasterize?.dpi)) {
    errors.push('rasterize.dpi must be 150 or 200');
  }

  for (const step of config.pipeline || []) {
    if (!step.component) {
      errors.push(`Pipeline step is missing component: ${step.id || '<unknown>'}`);
      continue;
    }
    try {
      await fs.access(path.join(componentDir, `${step.component}.js`));
    } catch (_) {
      errors.push(`Pipeline component does not exist: ${step.component}`);
    }
  }

  for (const docType of docTypes) {
    if (seen.has(docType.type)) errors.push(`Duplicate type: ${docType.type}`);
    seen.add(docType.type);
    if (!docType.name) errors.push(`${docType.type}: missing name`);
    if (!Array.isArray(docType.aliases)) errors.push(`${docType.type}: missing aliases array`);
    if (!Array.isArray(docType.recognitionFeatures)) errors.push(`${docType.type}: missing recognitionFeatures array`);
    if (!Array.isArray(docType.firstPassFields)) {
      errors.push(`${docType.type}: missing firstPassFields array`);
    } else if (new Set(docType.firstPassFields.map((field) => field.id)).size !== docType.firstPassFields.length) {
      errors.push(`${docType.type}: duplicate firstPassFields ids`);
    }
    if (!Array.isArray(docType.secondPassFields)) {
      errors.push(`${docType.type}: missing secondPassFields array`);
    } else if (new Set(docType.secondPassFields.map((field) => field.id)).size !== docType.secondPassFields.length) {
      errors.push(`${docType.type}: duplicate secondPassFields ids`);
    }
    if (!Array.isArray(docType.validationRules) && !docType.validationRules) {
      errors.push(`${docType.type}: missing validationRules`);
    }
    if (!docType.crmNaming?.template) errors.push(`${docType.type}: missing crmNaming.template`);
  }

  const result = {
    ok: true,
    errors,
    docTypes: docTypes.map((item) => item.type)
  };
  if (!options.silent) console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exitCode = 1;
  return result;
}
