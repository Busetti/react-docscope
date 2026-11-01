/**
 * react-docscope — universal, read-only React document preview.
 *
 * Import the stylesheet once in your app:
 *   import 'react-docscope/styles.css';
 */

import './styles/docscope.css';

// Components
export { DocumentPreviewer } from './components/DocumentPreviewer';
export type {
  DocumentPreviewerProps,
  DocumentPreviewerHandle,
} from './components/DocumentPreviewer';
export { PreviewModal } from './components/PreviewModal';
export type { PreviewModalProps } from './components/PreviewModal';
export { DocumentProvider } from './components/context';
export type { DocumentProviderProps } from './components/context';

// Hooks
export { useDocumentPreview } from './hooks/useDocumentPreview';
export type {
  UseDocumentPreviewOptions,
  UseDocumentPreviewResult,
} from './hooks/useDocumentPreview';

// Renderer extensibility
export { RendererRegistry, defineRenderer } from './core/registry';
export { builtInRenderers, createDefaultRegistry } from './renderers/definitions';
export { DocumentPreviewError } from './core/errors';
export { defaultResolver } from './core/source';
export { resolveConfig, DEFAULT_CONFIG, DEFAULT_LABELS, DEFAULT_SHORTCUTS } from './core/config';
export { getExtension, getMimeType } from './core/detect';
export { formatBytes } from './core/format';

// Types
export type {
  PreviewDocument,
  PreviewDocumentMetadata,
  DocumentResolver,
  ResolvedDocument,
  ResolverContext,
  ResolvePurpose,
  PreviewConfig,
  ResolvedPreviewConfig,
  PreviewLabels,
  PreviewLabelsInput,
  ShortcutAction,
  ShortcutMap,
  ThemeMode,
  FitMode,
  MetadataField,
  MetadataRenderContext,
  ToolbarAction,
  ToolbarActionContext,
  DownloadHandler,
  DownloadContext,
  PreviewCallbacks,
  PreviewError,
  PreviewErrorCode,
  RendererDefinition,
  RendererCapabilities,
  RendererProps,
  RendererHost,
  DocumentSource,
  LoadingStrategy,
  ViewState,
  SearchState,
  BuiltInFormat,
} from './types';
