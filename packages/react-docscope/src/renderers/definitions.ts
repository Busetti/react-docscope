import type { RendererDefinition } from '../types';
import { normalizeMime } from '../core/detect';
import { RendererRegistry } from '../core/registry';

/* Each `load` is a dynamic import so every renderer is its own chunk. */

export const pdfRenderer: RendererDefinition = {
  id: 'pdf',
  label: 'PDF',
  mimeTypes: ['application/pdf', 'application/x-pdf'],
  extensions: ['pdf'],
  capabilities: {
    zoom: true,
    fitModes: ['width', 'page'],
    rotate: true,
    pages: true,
    thumbnails: true,
    search: true,
    scrollModes: true,
    syncScroll: true,
  },
  loadingStrategy: 'url',
  load: () => import('./pdf/PdfRenderer'),
};

export const imageRenderer: RendererDefinition = {
  id: 'image',
  label: 'Image',
  mimeTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/avif',
    'image/bmp',
    'image/*',
  ],
  extensions: ['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'],
  capabilities: {
    zoom: true,
    fitModes: ['page', 'original'],
    rotate: true,
    pan: true,
    syncScroll: true,
  },
  loadingStrategy: 'blob',
  load: () => import('./image/ImageRenderer'),
};

export const docxRenderer: RendererDefinition = {
  id: 'docx',
  label: 'Word document',
  mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  extensions: ['docx', 'docm', 'dotx'],
  capabilities: { zoom: true, fitModes: ['width'], search: true, syncScroll: true },
  loadingStrategy: 'arrayBuffer',
  load: () => import('./docx/DocxRenderer'),
};

export const pptxRenderer: RendererDefinition = {
  id: 'pptx',
  label: 'PowerPoint presentation',
  mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  extensions: ['pptx', 'ppsx', 'potx'],
  capabilities: {
    zoom: true,
    fitModes: ['width', 'page'],
    pages: true,
    thumbnails: true,
    search: true,
    syncScroll: true,
  },
  loadingStrategy: 'arrayBuffer',
  load: () => import('./pptx/PptxRenderer'),
};

export const markdownRenderer: RendererDefinition = {
  id: 'markdown',
  label: 'Markdown',
  mimeTypes: ['text/markdown', 'text/x-markdown'],
  extensions: ['md', 'markdown', 'mdown', 'mkd'],
  capabilities: { zoom: true, search: true, rawView: true, syncScroll: true },
  loadingStrategy: 'text',
  load: () => import('./markdown/MarkdownRenderer'),
};

export const textRenderer: RendererDefinition = {
  id: 'text',
  label: 'Text',
  mimeTypes: ['text/plain', 'text/*'],
  extensions: [
    'txt',
    'text',
    'log',
    'ini',
    'cfg',
    'conf',
    'env',
    'properties',
    'yaml',
    'yml',
    'toml',
  ],
  capabilities: { zoom: true, search: true, syncScroll: true },
  loadingStrategy: 'text',
  priority: -1,
  load: () => import('./text/TextRenderer'),
};

export const videoRenderer: RendererDefinition = {
  id: 'video',
  label: 'Video',
  mimeTypes: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/*'],
  extensions: ['mp4', 'm4v', 'webm', 'ogv', 'mov'],
  capabilities: { media: true },
  loadingStrategy: 'url',
  load: () => import('./video/VideoRenderer'),
};

export const xlsxRenderer: RendererDefinition = {
  id: 'xlsx',
  label: 'Excel workbook',
  mimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroenabled.12',
  ],
  extensions: ['xlsx', 'xlsm'],
  capabilities: { zoom: true, search: true, syncScroll: true },
  loadingStrategy: 'arrayBuffer',
  load: () => import('./xlsx/XlsxRenderer'),
};

export const csvRenderer: RendererDefinition = {
  id: 'csv',
  label: 'CSV',
  mimeTypes: ['text/csv', 'application/csv', 'text/tab-separated-values'],
  extensions: ['csv', 'tsv', 'tab'],
  capabilities: { zoom: true, search: true, syncScroll: true },
  loadingStrategy: 'blob',
  load: () => import('./csv/CsvRenderer'),
};

export const jsonRenderer: RendererDefinition = {
  id: 'json',
  label: 'JSON',
  mimeTypes: ['application/json', 'text/json', 'application/geo+json', 'application/ld+json'],
  extensions: ['json', 'geojson', 'jsonld', 'har', 'webmanifest'],
  capabilities: { zoom: true, search: true, rawView: true, syncScroll: true },
  loadingStrategy: 'text',
  match: (doc) => /\+json$/.test(normalizeMime(doc.type)),
  load: () => import('./json/JsonRenderer'),
};

export const xmlRenderer: RendererDefinition = {
  id: 'xml',
  label: 'XML',
  mimeTypes: ['application/xml', 'text/xml', 'application/rss+xml', 'application/atom+xml'],
  extensions: ['xml', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist', 'wsdl'],
  capabilities: { zoom: true, search: true, rawView: true, syncScroll: true },
  loadingStrategy: 'text',
  load: () => import('./xml/XmlRenderer'),
};

export const builtInRenderers: RendererDefinition[] = [
  pdfRenderer,
  imageRenderer,
  docxRenderer,
  pptxRenderer,
  markdownRenderer,
  textRenderer,
  videoRenderer,
  xlsxRenderer,
  csvRenderer,
  jsonRenderer,
  xmlRenderer,
];

export function createDefaultRegistry(extra?: RendererDefinition[]): RendererRegistry {
  return new RendererRegistry(builtInRenderers).extend(extra);
}
