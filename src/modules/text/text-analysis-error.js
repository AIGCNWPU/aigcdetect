export class TextAnalysisError extends Error {
  constructor(code, message, status = 400, expose = true) {
    super(message);
    this.name = 'TextAnalysisError';
    this.code = code;
    this.status = status;
    this.expose = expose;
  }
}
