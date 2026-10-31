import type { DocumentResolver, PreviewDocument } from 'react-docscope';

const f = (id: string, name: string, description?: string): PreviewDocument => ({
  id,
  name,
  url: `/fixtures/${name}`,
  metadata: {
    uploadedBy: 'Storybook',
    uploadedAt: '2026-10-01T09:30:00Z',
    ...(description ? { description } : {}),
  },
});

export const samples = {
  pdf: f('pdf', 'sample.pdf', '6-page report'),
  docx: f('docx', 'proposal.docx'),
  pptx: f('pptx', 'deck.pptx'),
  xlsx: f('xlsx', 'budget.xlsx', 'Read-only workbook'),
  csv: f('csv', 'customers.csv'),
  md: f('md', 'readme.md'),
  txt: f('txt', 'notes.txt'),
  json: f('json', 'config.json'),
  xml: f('xml', 'catalog.xml'),
  image: f('image', 'photo.jpg'),
  svg: f('svg', 'icon.svg'),
  video: f('video', 'clip.mp4'),
};

export const allSamples = Object.values(samples);

export const failing: PreviewDocument[] = [
  { id: 'missing', name: 'missing.pdf', url: '/fixtures/does-not-exist.pdf' },
  f('malformed', 'malformed.docx'),
  f('empty', 'empty.txt'),
  { id: 'unknown', name: 'archive.bin', url: '/fixtures/unknown.bin' },
];

export const urlResolver: DocumentResolver = async (doc) => ({ kind: 'url', url: doc.url! });
