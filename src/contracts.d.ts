/** 场景级接口占位。字段在后续具体业务实现时确定。 */
export type ModuleId = 'text' | 'image' | 'video' | 'audio';
export interface ApiSuccess<T> { data: T; requestId: string }
export interface ApiError { error: { code: string; message: string }; requestId: string }
export interface ScenarioContract {
  id: string;
  moduleId: ModuleId;
  title: string;
  path: string;
  api: { method: 'POST'; path: string; operationId: string; implemented: boolean };
}
export type ScenarioRequest = Record<string, unknown>;
