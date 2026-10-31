import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ComponentType } from 'react';
import type { PreviewDocument } from '../types';
import { PreviewModal, type PreviewModalProps } from '../components/PreviewModal';
import type { DocumentPreviewerHandle } from '../components/DocumentPreviewer';

export interface UseDocumentPreviewOptions extends Omit<
  PreviewModalProps,
  'open' | 'onOpenChange' | 'activeDocumentId' | 'defaultDocumentId' | 'defaultCompare' | 'document'
> {
  documents: PreviewDocument[];
}

export interface UseDocumentPreviewResult {
  /** Opens the modal at a document id (defaults to the first document). */
  open: (documentId?: string) => void;
  close: () => void;
  /** Opens the modal in compare mode. */
  compare: (leftId: string, rightId: string) => void;
  isOpen: boolean;
  activeDocument: PreviewDocument | null;
  /** Render once anywhere; it portals the modal into `document.body`. Stable identity. */
  PreviewPortal: ComponentType;
}

interface State {
  open: boolean;
  activeId: string | null;
  compare: [string, string] | null;
  /** Bumped on every open() so the modal starts on the requested document. */
  session: number;
}

type Listener = () => void;

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/**
 * Headless hook: lets an existing attachments UI open the preview modal by
 * document id. Render `<PreviewPortal />` once; options can change on every
 * render without remounting the modal.
 */
export function useDocumentPreview(options: UseDocumentPreviewOptions): UseDocumentPreviewResult {
  const [state, setState] = useState<State>({
    open: false,
    activeId: null,
    compare: null,
    session: 0,
  });
  const store = useRef<ReturnType<
    typeof createStore<{
      options: UseDocumentPreviewOptions;
      state: State;
      setState: (s: State | ((p: State) => State)) => void;
    }>
  > | null>(null);
  if (!store.current) store.current = createStore({ options, state, setState });

  // Publishes the latest options/state to the portal store after every render.
  // `setState` is only forwarded, never called here, so there is no update loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    store.current!.set({ options, state, setState });
  });

  const open = useCallback((documentId?: string) => {
    setState((s) => ({
      open: true,
      activeId: documentId ?? null,
      compare: null,
      session: s.session + 1,
    }));
  }, []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const compare = useCallback((leftId: string, rightId: string) => {
    setState((s) => ({
      open: true,
      activeId: leftId,
      compare: [leftId, rightId],
      session: s.session + 1,
    }));
  }, []);

  const PreviewPortal = useMemo(() => {
    const s = store.current!;
    function DocumentPreviewPortal() {
      const snap = useSyncExternalStore(s.subscribe, s.get, s.get);
      const handle = useRef<DocumentPreviewerHandle>(null);
      const { options: opts, state: st, setState: set } = snap;
      const { onDocumentChange, ...rest } = opts;
      return (
        <PreviewModal
          key={st.session}
          {...rest}
          ref={handle}
          open={st.open}
          onOpenChange={(o) => set((p) => ({ ...p, open: o }))}
          {...(st.activeId ? { defaultDocumentId: st.activeId } : {})}
          {...(st.compare ? { defaultCompare: st.compare } : {})}
          onDocumentChange={(doc, index) => {
            set((p) => (p.activeId === doc.id ? p : { ...p, activeId: doc.id }));
            onDocumentChange?.(doc, index);
          }}
          onCompareChange={(pair) => {
            set((p) => ({ ...p, compare: pair }));
            opts.onCompareChange?.(pair);
          }}
        />
      );
    }
    return DocumentPreviewPortal;
  }, []);

  const activeDocument = state.activeId
    ? (options.documents.find((d) => d.id === state.activeId) ?? null)
    : state.open
      ? (options.documents[0] ?? null)
      : null;

  return { open, close, compare, isOpen: state.open, activeDocument, PreviewPortal };
}
