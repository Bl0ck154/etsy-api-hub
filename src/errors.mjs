export class EtsyHubError extends Error {
  constructor(message, { code = 'ETSY_HUB_ERROR', status = 500, details = null } = {}) {
    super(message);
    this.name = 'EtsyHubError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function inputError(message, code = 'INVALID_INPUT') {
  return new EtsyHubError(message, { code, status: 400 });
}
