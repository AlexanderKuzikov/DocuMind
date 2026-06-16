import { buildUniversalPrompt } from '../prompt-builder.js';

export const meta = {
  id: 'build-universal-prompt',
  version: '0.1.0',
  input: ['docTypes'],
  output: ['universalPrompt']
};

export async function run(context) {
  const prompt = await buildUniversalPrompt(context.config, context.docTypes);
  return {
    ok: true,
    artifacts: { universalPrompt: prompt }
  };
}
