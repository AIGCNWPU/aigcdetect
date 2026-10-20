import { textPages } from './text/pages.js';
import { imagePages } from './image/pages.js';
import { videoPages } from './video/pages.js';
import { audioPages } from './audio/pages.js';

export const pageRenderers = [...textPages, ...imagePages, ...videoPages, ...audioPages];
