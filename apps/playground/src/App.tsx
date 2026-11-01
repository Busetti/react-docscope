import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DocumentPreviewer,
  DocumentProvider,
  useDocumentPreview,
  type DocumentResolver,
  type PreviewConfig,
  type PreviewDocument,
  type ToolbarAction,
} from 'react-docscope';
import { Eye, FileUp, Moon, Monitor, Share2, Sun } from 'lucide-react';
import { de, en, es, fr, hi } from 'react-docscope/locales';
import {
  allFormats,
  compareDocs,
  createLocalFileResolver,
  createSignedUrlResolver,
  directResolver,
  failureDocs,
  failureResolver,
  headerResolver,
  largeDocs,
} from './scenarios';
import { CodeSample } from './CodeSample';

type ScenarioId =
  'attachments' | 'single' | 'compare' | 'signed' | 'headers' | 'failures' | 'large' | 'local';
type Mode = 'modal' | 'inline';

const SCENARIOS: Array<{ id: ScenarioId; label: string; hint: string }> = [
  {
    id: 'attachments',
    label: 'All formats',
    hint: 'Every supported format as an attachment list.',
  },
  { id: 'single', label: 'Single document', hint: 'One document, no attachment navigation.' },
  {
    id: 'compare',
    label: 'Compare',
    hint: 'Split-screen comparison of two documents (any formats).',
  },
  {
    id: 'signed',
    label: 'Signed URLs',
    hint: 'Mock backend issues expiring signed URLs; the first one is already expired.',
  },
  {
    id: 'headers',
    label: 'Auth headers',
    hint: 'Resolver returns an Authorization header (never logged).',
  },
  {
    id: 'failures',
    label: 'Failures',
    hint: 'Resolver errors, 404/500/403, malformed, empty and unsupported files.',
  },
  {
    id: 'large',
    label: 'Large documents',
    hint: '400-page PDF, 200k-row CSV, 20k-row XLSX, 200k-line log, big JSON/XML.',
  },
  {
    id: 'local',
    label: 'Local files',
    hint: 'Pick files from your computer — previewed in memory, never uploaded.',
  },
];

const LOCALES = { en, de, es, fr, hi };

interface Settings {
  theme: 'light' | 'dark' | 'system';
  mode: Mode;
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
  pdfScroll: 'continuous' | 'single';
  pdfThumbnails: boolean;
  defaultFit: 'width' | 'page' | 'none';
  defaultZoom: number;
  prefetch: boolean;
  workers: boolean;
  language: keyof typeof LOCALES;
  customAction: boolean;
}

const DEFAULTS: Settings = {
  theme: 'system',
  mode: 'modal',
  width: '100%',
  height: 640,
  toolbar: true,
  sidebar: 'auto',
  search: true,
  download: true,
  compare: true,
  metadata: true,
  fullscreen: true,
  shortcuts: true,
  pdfScroll: 'continuous',
  pdfThumbnails: false,
  defaultFit: 'width',
  defaultZoom: 1,
  prefetch: true,
  workers: true,
  language: 'en',
  customAction: false,
};

function readUrlState(): { scenario: ScenarioId; settings: Settings } {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const scenario = (params.get('scenario') as ScenarioId) || 'attachments';
    const settings = {
      ...DEFAULTS,
      ...(params.get('s') ? (JSON.parse(atob(params.get('s')!)) as Partial<Settings>) : {}),
    };
    return {
      scenario: SCENARIOS.some((s) => s.id === scenario) ? scenario : 'attachments',
      settings,
    };
  } catch {
    return { scenario: 'attachments', settings: DEFAULTS };
  }
}

export function App() {
  const initial = useMemo(readUrlState, []);
  const [scenario, setScenario] = useState<ScenarioId>(initial.scenario);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [log, setLog] = useState<string[]>([]);
  const [localDocs, setLocalDocs] = useState<PreviewDocument[]>([]);
  const files = useRef(new Map<string, File>());
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  useEffect(() => {
    const params = new URLSearchParams({ scenario, s: btoa(JSON.stringify(settings)) });
    window.history.replaceState(null, '', `#${params.toString()}`);
  }, [scenario, settings]);

  const appendLog = useCallback((line: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 60));
  }, []);

  const signedResolver = useMemo(() => createSignedUrlResolver(appendLog), [appendLog]);
  const localResolver = useMemo(() => createLocalFileResolver(files.current), []);

  const { documents, resolver } = useMemo((): {
    documents: PreviewDocument[];
    resolver: DocumentResolver;
  } => {
    switch (scenario) {
      case 'single':
        return { documents: [allFormats[0]!], resolver: directResolver };
      case 'compare':
        return { documents: compareDocs, resolver: directResolver };
      case 'signed':
        return { documents: allFormats.slice(0, 6), resolver: signedResolver };
      case 'headers':
        return { documents: allFormats.slice(0, 5), resolver: headerResolver };
      case 'failures':
        return { documents: failureDocs, resolver: failureResolver };
      case 'large':
        return { documents: largeDocs, resolver: directResolver };
      case 'local':
        return { documents: localDocs, resolver: localResolver };
      default:
        return { documents: allFormats, resolver: directResolver };
    }
  }, [scenario, signedResolver, localResolver, localDocs]);

  const config = useMemo<PreviewConfig>(
    () => ({
      theme: settings.theme,
      width: settings.width,
      height: settings.height,
      toolbar: settings.toolbar,
      sidebar: settings.sidebar,
      search: settings.search,
      download: settings.download,
      compare: settings.compare,
      metadata: settings.metadata,
      fullscreen: settings.fullscreen,
      shortcuts: settings.shortcuts ? undefined : false,
      prefetch: settings.prefetch ? 'adjacent' : 'none',
      workers: settings.workers,
      labels: LOCALES[settings.language],
      pdf: { scrollMode: settings.pdfScroll, thumbnails: settings.pdfThumbnails },
      zoom: { defaultFit: settings.defaultFit, default: settings.defaultZoom },
      metadataFields: [
        'type',
        'size',
        'uploadedAt',
        'uploadedBy',
        'description',
        { key: 'department', label: 'Department' },
      ],
    }),
    [settings],
  );

  const toolbarActions = useMemo<ToolbarAction[]>(
    () =>
      settings.customAction
        ? [
            {
              id: 'share',
              label: 'Share link',
              icon: <Share2 size={18} aria-hidden="true" />,
              onClick: ({ document }) => appendLog(`custom action "share" for ${document.name}`),
            },
          ]
        : [],
    [settings.customAction, appendLog],
  );

  const callbacks = {
    onDocumentChange: (d: PreviewDocument, i: number) =>
      appendLog(`onDocumentChange → ${d.name} (#${i + 1})`),
    onError: (e: { code: string; message: string }, d: PreviewDocument) =>
      appendLog(`onError → ${d.name}: ${e.code} — ${e.message}`),
    onLoad: (d: PreviewDocument) => appendLog(`onLoad → ${d.name}`),
  };

  const onPickFiles = (list: FileList | null) => {
    if (!list) return;
    const docs: PreviewDocument[] = [];
    for (const file of Array.from(list)) {
      const id = `local-${file.name}-${file.size}-${file.lastModified}`;
      files.current.set(id, file);
      docs.push({
        id,
        name: file.name,
        ...(file.type ? { type: file.type } : {}),
        metadata: {
          size: file.size,
          uploadedAt: new Date(file.lastModified).toISOString(),
          uploadedBy: 'You (local)',
        },
      });
    }
    setLocalDocs((prev) => [...prev.filter((p) => !docs.some((d) => d.id === p.id)), ...docs]);
  };

  const current = SCENARIOS.find((s) => s.id === scenario)!;

  return (
    <DocumentProvider>
      <div className="pg">
        <header className="pg-header">
          <div className="pg-brand">
            <span className="pg-logo" aria-hidden="true" />
            <div>
              <h1>DocScope</h1>
              <p>react-docscope playground</p>
            </div>
          </div>
          <nav className="pg-tabs" aria-label="Scenarios">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === scenario}
                onClick={() => setScenario(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="pg-theme" role="group" aria-label="Theme">
            {(
              [
                ['light', <Sun key="l" size={16} />],
                ['dark', <Moon key="d" size={16} />],
                ['system', <Monitor key="s" size={16} />],
              ] as const
            ).map(([t, icon]) => (
              <button
                key={t}
                type="button"
                aria-label={`${t} theme`}
                aria-pressed={settings.theme === t}
                onClick={() => set('theme', t)}
              >
                {icon}
              </button>
            ))}
          </div>
        </header>

        <div className="pg-layout">
          <ConfigPanel settings={settings} set={set} reset={() => setSettings(DEFAULTS)} />

          <main className="pg-main">
            <div className="pg-scenario">
              <div>
                <h2>{current.label}</h2>
                <p>{current.hint}</p>
              </div>
              {scenario === 'local' && (
                <label className="pg-file">
                  <FileUp size={16} aria-hidden="true" /> Choose files
                  <input
                    type="file"
                    multiple
                    onChange={(e) => onPickFiles(e.target.files)}
                    data-testid="local-file-input"
                  />
                </label>
              )}
            </div>

            {scenario === 'local' && documents.length === 0 ? (
              <div className="pg-empty">
                Choose one or more files (PDF, Office, images, CSV, JSON, video…) to preview them
                locally.
              </div>
            ) : settings.mode === 'modal' ? (
              <ModalDemo
                key={scenario}
                documents={documents}
                resolver={resolver}
                config={config}
                toolbarActions={toolbarActions}
                callbacks={callbacks}
                startCompare={scenario === 'compare'}
              />
            ) : (
              <DocumentPreviewer
                key={scenario}
                documents={documents}
                resolver={resolver}
                config={config}
                toolbarActions={toolbarActions}
                {...(scenario === 'compare'
                  ? { defaultCompare: ['pdf-a', 'pdf-b'] as [string, string] }
                  : {})}
                {...callbacks}
              />
            )}

            <section className="pg-log" aria-label="Event log">
              <div className="pg-log-head">
                <h3>Events &amp; resolver calls</h3>
                <button type="button" onClick={() => setLog([])}>
                  Clear
                </button>
              </div>
              <ol data-testid="event-log">
                {log.length === 0 ? (
                  <li className="pg-muted">Interact with the preview to see callbacks here.</li>
                ) : (
                  log.map((l, i) => <li key={i}>{l}</li>)
                )}
              </ol>
            </section>
          </main>

          <CodeSample settings={settings} scenario={scenario} />
        </div>
      </div>
    </DocumentProvider>
  );
}

function ModalDemo({
  documents,
  resolver,
  config,
  toolbarActions,
  callbacks,
  startCompare,
}: {
  documents: PreviewDocument[];
  resolver: DocumentResolver;
  config: PreviewConfig;
  toolbarActions: ToolbarAction[];
  callbacks: Record<string, unknown>;
  startCompare: boolean;
}) {
  const { open, compare, PreviewPortal } = useDocumentPreview({
    documents,
    resolver,
    config,
    toolbarActions,
    ...callbacks,
  });
  return (
    <div className="pg-attachments">
      {startCompare && documents.length > 1 && (
        <button
          type="button"
          className="pg-primary"
          onClick={() => compare(documents[0]!.id, documents[1]!.id)}
        >
          Compare “{documents[0]!.name}” with “{documents[1]!.name}”
        </button>
      )}
      <ul className="pg-attachment-list" aria-label="Attachments">
        {documents.map((d) => (
          <li key={d.id}>
            <span className="pg-ext">{(d.name.split('.').pop() ?? '').toUpperCase()}</span>
            <span className="pg-name">
              {d.name}
              {typeof d.metadata?.description === 'string' && (
                <small>{d.metadata.description}</small>
              )}
            </span>
            <button type="button" onClick={() => open(d.id)} aria-label={`Preview ${d.name}`}>
              <Eye size={16} aria-hidden="true" /> Preview
            </button>
          </li>
        ))}
      </ul>
      <PreviewPortal />
    </div>
  );
}

function ConfigPanel({
  settings,
  set,
  reset,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}) {
  const toggle = (key: keyof Settings, label: string) => (
    <label className="pg-toggle">
      <input
        type="checkbox"
        checked={!!settings[key]}
        onChange={(e) => set(key, e.target.checked as never)}
      />
      {label}
    </label>
  );
  return (
    <aside className="pg-config" aria-label="Configuration">
      <div className="pg-config-head">
        <h2>Configuration</h2>
        <button type="button" onClick={reset}>
          Reset
        </button>
      </div>
      <fieldset>
        <legend>Mode</legend>
        <div className="pg-seg" role="group" aria-label="Preview mode">
          {(['modal', 'inline'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={settings.mode === m}
              onClick={() => set('mode', m)}
            >
              {m === 'modal' ? 'Modal' : 'Inline'}
            </button>
          ))}
        </div>
      </fieldset>
      {settings.mode === 'inline' && (
        <fieldset>
          <legend>Inline size</legend>
          <label className="pg-field">
            Width
            <select value={settings.width} onChange={(e) => set('width', e.target.value)}>
              <option value="100%">100%</option>
              <option value="800px">800px</option>
              <option value="600px">600px</option>
              <option value="420px">420px (narrow)</option>
            </select>
          </label>
          <label className="pg-field">
            Height <output>{settings.height}px</output>
            <input
              type="range"
              min={320}
              max={1000}
              step={20}
              value={settings.height}
              onChange={(e) => set('height', Number(e.target.value))}
            />
          </label>
        </fieldset>
      )}
      <fieldset>
        <legend>Features</legend>
        {toggle('toolbar', 'Toolbar')}
        <label className="pg-field">
          Sidebar
          <select
            value={String(settings.sidebar)}
            onChange={(e) =>
              set('sidebar', e.target.value === 'auto' ? 'auto' : e.target.value === 'true')
            }
          >
            <option value="auto">auto (2+ documents)</option>
            <option value="true">always</option>
            <option value="false">hidden</option>
          </select>
        </label>
        {toggle('search', 'Search')}
        {toggle('download', 'Download')}
        {toggle('compare', 'Compare')}
        {toggle('metadata', 'Metadata panel')}
        {toggle('fullscreen', 'Fullscreen')}
        {toggle('shortcuts', 'Keyboard shortcuts')}
        {toggle('prefetch', 'Prefetch adjacent (small files)')}
        {toggle('workers', 'Parse XLSX/CSV in a worker')}
        {toggle('customAction', 'Custom toolbar action')}
      </fieldset>
      <fieldset>
        <legend>View defaults</legend>
        <label className="pg-field">
          Language
          <select
            value={settings.language}
            onChange={(e) => set('language', e.target.value as Settings['language'])}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="hi">हिन्दी</option>
          </select>
        </label>
        <label className="pg-field">
          Default fit
          <select
            value={settings.defaultFit}
            onChange={(e) => set('defaultFit', e.target.value as Settings['defaultFit'])}
          >
            <option value="width">Fit width</option>
            <option value="page">Fit page</option>
            <option value="none">None (use zoom)</option>
          </select>
        </label>
        <label className="pg-field">
          Default zoom <output>{Math.round(settings.defaultZoom * 100)}%</output>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.25}
            value={settings.defaultZoom}
            onChange={(e) => set('defaultZoom', Number(e.target.value))}
          />
        </label>
        <label className="pg-field">
          PDF scroll
          <select
            value={settings.pdfScroll}
            onChange={(e) => set('pdfScroll', e.target.value as Settings['pdfScroll'])}
          >
            <option value="continuous">Continuous</option>
            <option value="single">Single page</option>
          </select>
        </label>
        {toggle('pdfThumbnails', 'PDF thumbnails open')}
      </fieldset>
      <p className="pg-muted pg-shortcuts">
        Shortcuts: <kbd>Ctrl/⌘ F</kbd> search · <kbd>+</kbd>/<kbd>-</kbd> zoom · <kbd>0</kbd> reset
        · <kbd>Alt ←/→</kbd> documents · <kbd>PgUp/PgDn</kbd> pages · <kbd>R</kbd> rotate ·{' '}
        <kbd>F</kbd> fullscreen · <kbd>Esc</kbd> close
      </p>
    </aside>
  );
}
