export function makeError(code, message, stage, options = {}) {
  return {
    code,
    message,
    stage,
    recoverable: options.recoverable ?? false,
    probableCauses: options.probableCauses ?? [],
    suggestions: options.suggestions ?? []
  };
}

export function statusFromErrors(errors) {
  if (!errors.length) return 'ok';
  if (errors.some((error) => !error.recoverable)) return 'failed';
  return 'partial';
}
