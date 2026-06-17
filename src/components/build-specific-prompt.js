import { buildSpecificPrompt, buildUnknownPrompt } from '../prompt-builder.js';

export const meta = {
  id: 'build-specific-prompt',
  version: '0.1.0',
  input: ['firstPassResult'],
  output: ['specificPrompt', 'selectedDocType']
};

export async function run(context) {
  const firstPass = context.artifacts.firstPassResult || {};
  const docType = firstPass.docType || 'unknown';
  const docTypeConfig = context.docTypes.find((item) => item.type === docType) || null;

  let specificPrompt;
  if (docTypeConfig) {
    specificPrompt = await buildSpecificPrompt(context.config, docTypeConfig, firstPass);
  } else {
    specificPrompt = await buildUnknownPrompt(context.config, firstPass);
  }

  return {
    ok: true,
    artifacts: {
      specificPrompt,
      selectedDocType: docTypeConfig
    }
  };
}
