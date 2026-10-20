import { textModule } from './modules/text/definition.js';
import { imageModule } from './modules/image/definition.js';
import { videoModule } from './modules/video/definition.js';
import { audioModule } from './modules/audio/definition.js';

// 模块定义分开维护，目录与 API 清单仍统一从此聚合。
export const modules = [textModule, imageModule, videoModule, audioModule];
export const scenarios = modules.flatMap(module => module.scenarios);
