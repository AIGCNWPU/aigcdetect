export class NotImplementedError extends Error {
  constructor(operationId) {
    super('该场景接口已预留，业务功能尚未实现。');
    this.name = 'NotImplementedError';
    this.code = 'NOT_IMPLEMENTED';
    this.status = 501;
    this.operationId = operationId;
  }
}
