import { renderTextAcademic } from './pages/academic.js';
import { renderTextNews } from './pages/news.js';
import { renderTextNovel } from './pages/novel.js';

export const textPages = [
  ['/text/academic', renderTextAcademic],
  ['/text/news', renderTextNews],
  ['/text/novel', renderTextNovel],
];
