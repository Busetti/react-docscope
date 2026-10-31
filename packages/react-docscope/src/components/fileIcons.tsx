import {
  File,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from 'lucide-react';
import type { RendererRegistry } from '../core/registry';
import type { PreviewDocument } from '../types';

export function FileIcon({
  document,
  registry,
  size = 18,
}: {
  document: PreviewDocument;
  registry: RendererRegistry;
  size?: number;
}) {
  const id = registry.resolve(document)?.id;
  const props = {
    size,
    'aria-hidden': true as const,
    className: `dsc-file-icon dsc-file-icon--${id ?? 'unknown'}`,
  };
  switch (id) {
    case 'image':
      return <FileImage {...props} />;
    case 'video':
      return <FileVideo {...props} />;
    case 'xlsx':
    case 'csv':
      return <FileSpreadsheet {...props} />;
    case 'pptx':
      return <Presentation {...props} />;
    case 'json':
      return <FileJson {...props} />;
    case 'xml':
      return <FileCode {...props} />;
    case 'pdf':
    case 'docx':
    case 'markdown':
    case 'text':
      return <FileText {...props} />;
    default:
      return <File {...props} />;
  }
}
