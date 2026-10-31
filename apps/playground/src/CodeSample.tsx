import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface Props {
  scenario: string;
  settings: {
    theme: string;
    mode: 'modal' | 'inline';
    width: string;
    height: number;
    toolbar: boolean;
    sidebar: boolean | 'auto';
    search: boolean;
    download: boolean;
    compare: boolean;
    metadata: boolean;
    fullscreen: boolean;
    shortcuts: boolean;
    pdfScroll: string;
    pdfThumbnails: boolean;
    defaultFit: string;
    defaultZoom: number;
    prefetch: boolean;
  };
}

const RESOLVERS: Record<string, string> = {
  signed: `// Your backend signs a short-lived URL (S3, GCS, VAST…).
const resolveDocument: DocumentResolver = async (doc, { signal, purpose, attempt }) => {
  const res = await fetch(\`/api/files/\${doc.id}/signed-url?purpose=\${purpose}&fresh=\${attempt > 0}\`, { signal });
  const { url } = await res.json();
  return { kind: 'url', url }; // expired URLs (401/403) are re-resolved automatically
};`,
  headers: `const resolveDocument: DocumentResolver = async (doc) => ({
  kind: 'url',
  url: \`/api/files/\${doc.id}/content\`,
  headers: { Authorization: \`Bearer \${getToken()}\` }, // never logged
});`,
  local: `// Preview a File from <input type="file"> without uploading it.
const resolveDocument: DocumentResolver = async (doc) => ({ kind: 'blob', blob: filesById.get(doc.id)! });`,
};

const DEFAULT_RESOLVER = `const resolveDocument: DocumentResolver = async (doc, { signal }) => {
  const { url } = await api.getDownloadUrl(doc.id, { signal });
  return { kind: 'url', url };
};`;

function configLines(s: Props['settings']): string[] {
  const out: string[] = [];
  if (s.theme !== 'system') out.push(`theme: '${s.theme}'`);
  if (s.mode === 'inline') {
    if (s.width !== '100%') out.push(`width: '${s.width}'`);
    if (s.height !== 600) out.push(`height: ${s.height}`);
  }
  for (const k of ['toolbar', 'search', 'download', 'compare', 'metadata', 'fullscreen'] as const)
    if (!s[k]) out.push(`${k}: false`);
  if (s.sidebar !== 'auto') out.push(`sidebar: ${s.sidebar}`);
  if (!s.shortcuts) out.push('shortcuts: false');
  if (!s.prefetch) out.push(`prefetch: 'none'`);
  const pdf: string[] = [];
  if (s.pdfScroll !== 'continuous') pdf.push(`scrollMode: '${s.pdfScroll}'`);
  if (s.pdfThumbnails) pdf.push('thumbnails: true');
  if (pdf.length) out.push(`pdf: { ${pdf.join(', ')} }`);
  const zoom: string[] = [];
  if (s.defaultFit !== 'width') zoom.push(`defaultFit: '${s.defaultFit}'`);
  if (s.defaultZoom !== 1) zoom.push(`default: ${s.defaultZoom}`);
  if (zoom.length) out.push(`zoom: { ${zoom.join(', ')} }`);
  return out;
}

export function buildSnippet({ scenario, settings }: Props): string {
  const lines = configLines(settings);
  const config = lines.length
    ? `\nconst config: PreviewConfig = {\n  ${lines.join(',\n  ')},\n};\n`
    : '';
  const configProp = lines.length ? '\n    config,' : '';
  const resolver = RESOLVERS[scenario] ?? DEFAULT_RESOLVER;
  const imports =
    settings.mode === 'modal'
      ? `import { useDocumentPreview, type DocumentResolver${lines.length ? ', type PreviewConfig' : ''} } from 'react-docscope';`
      : `import { DocumentPreviewer, type DocumentResolver${lines.length ? ', type PreviewConfig' : ''} } from 'react-docscope';`;
  const body =
    settings.mode === 'modal'
      ? `export function Attachments({ attachments }) {
  const { open, ${scenario === 'compare' ? 'compare, ' : ''}PreviewPortal } = useDocumentPreview({
    documents: attachments,
    resolver: resolveDocument,${configProp}
  });

  return (
    <>
      {attachments.map((a) => (
        <button key={a.id} onClick={() => open(a.id)}>{a.name}</button>
      ))}${scenario === 'compare' ? `\n      <button onClick={() => compare(attachments[0].id, attachments[1].id)}>Compare</button>` : ''}
      <PreviewPortal />
    </>
  );
}`
      : `export function Attachments({ attachments }) {
  return (
    <DocumentPreviewer
      documents={attachments}
      resolver={resolveDocument}${configProp.replace('\n    config,', '\n      config={config}')}${scenario === 'compare' ? `\n      defaultCompare={[attachments[0].id, attachments[1].id]}` : ''}
    />
  );
}`;
  return `${imports}
import 'react-docscope/styles.css';

${resolver}
${config}
${body}
`;
}

export function CodeSample(props: Props) {
  const [copied, setCopied] = useState(false);
  const code = buildSnippet(props);
  return (
    <aside className="pg-code" aria-label="Integration code">
      <div className="pg-config-head">
        <h2>Integration code</h2>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{' '}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
      <p className="pg-muted">
        Install with <code>npm install react-docscope</code>. React 18 and 19 are supported; no
        Tailwind, Redux or UI-kit setup is required.
      </p>
    </aside>
  );
}
