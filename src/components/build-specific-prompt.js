import { findDocType } from '../doc-type-registry.js';
import { buildSpecificPrompt, buildUnknownPrompt } from '../prompt-builder.js';

export const meta = {
  id: 'build-specific-prompt',
  version: '0.1.0',
  input: ['firstPassResult', 'docTypes'],
  output: ['specificPrompt', 'selectedDocType']
};

export async function run(context) {
  const firstPassResult = context.artifacts.firstPassResult;
  const docType = firstPassResult?.docType || 'unknown';
  const docTypeConfig = docType === 'unknown' ? null : findDocType(context.docTypes, docType);

  const prompt = docTypeConfig
    ? await buildSpecificPrompt(context.config, docTypeConfig, firstPassResult)
    : await buildUnknownPrompt(context.config, firstPassResult);

  return {
    ok: true,
    artifacts: {
      selectedDocType: docTypeConfig,
      specificPrompt: prompt
    }
  };
}
