import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { DocumentPreviewerHandle, DocumentPreviewerProps } from './DocumentPreviewer';
import { PreviewWorkspace } from './DocumentPreviewer';
import { usePreviewEnvironment } from './context';
import { cssSize, useResolvedTheme } from '../hooks/utils';

export interface PreviewModalProps extends DocumentPreviewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after the modal opens. */
  onOpen?: () => void;
  /** Fired after the modal closes. */
  onClose?: () => void;
  /** Accessible description (defaults to a generic one). */
  description?: string;
  /** Element to portal into (defaults to document.body). */
  container?: HTMLElement | null;
}

/**
 * Accessible modal document workspace (Radix Dialog): focus trap, Escape to
 * close, scroll lock, title / metadata, toolbar, search, attachments,
 * fullscreen, downloads and comparison.
 */
export const PreviewModal = forwardRef<DocumentPreviewerHandle, PreviewModalProps>(
  function PreviewModal(
    { open, onOpenChange, onOpen, onClose, description, container, ...previewerProps },
    ref,
  ) {
    const env = usePreviewEnvironment(previewerProps);
    const theme = useResolvedTheme(env.config.theme);
    const workspaceRef = useRef<DocumentPreviewerHandle>(null);
    useImperativeHandle(ref, () => ({
      handleEscape: () => workspaceRef.current?.handleEscape() ?? false,
      compare: (l, r) => workspaceRef.current?.compare(l, r),
      exitCompare: () => workspaceRef.current?.exitCompare(),
      select: (id) => workspaceRef.current?.select(id),
    }));

    const openRef = useRef({ onOpen, onClose });
    openRef.current = { onOpen, onClose };
    const wasOpen = useRef(false);
    // Element to return focus to after closing (the consumer's "Preview" button).
    const returnFocus = useRef<HTMLElement | null>(null);
    if (open && !wasOpen.current && typeof document !== 'undefined') {
      returnFocus.current = document.activeElement as HTMLElement | null;
    }
    useEffect(() => {
      if (open && !wasOpen.current) openRef.current.onOpen?.();
      if (!open && wasOpen.current) openRef.current.onClose?.();
      wasOpen.current = open;
    }, [open]);

    const { modal } = env.config;
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal container={container ?? undefined}>
          <Dialog.Overlay className="dsc-overlay" data-dsc-theme={theme} />
          <Dialog.Content
            className="dsc-modal"
            tabIndex={-1}
            data-dsc-theme={theme}
            style={{ width: cssSize(modal.width), height: cssSize(modal.height) }}
            onOpenAutoFocus={(e) => {
              // Focus the dialog itself rather than the first toolbar button (which would pop its tooltip).
              // Keyboard shortcuts are handled on the workspace root, so it receives focus.
              e.preventDefault();
              const root = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
                '.dsc-root',
              );
              root?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(e) => {
              const target = returnFocus.current;
              if (target && target.isConnected && target !== document.body) {
                e.preventDefault();
                target.focus({ preventScroll: true });
              }
            }}
            onEscapeKeyDown={(e) => {
              if (document.fullscreenElement || workspaceRef.current?.handleEscape())
                e.preventDefault();
            }}
            onPointerDownOutside={(e) => {
              if (!modal.closeOnBackdrop) e.preventDefault();
            }}
            onInteractOutside={(e) => {
              // Tooltips are portalled inside the modal; ignore stray outside events from them.
              if ((e.target as HTMLElement | null)?.closest?.('.dsc-tooltip')) e.preventDefault();
            }}
          >
            <Dialog.Description className="dsc-visually-hidden">
              {description ?? env.config.labels.modalDescription}
            </Dialog.Description>
            <PreviewWorkspace
              {...previewerProps}
              ref={workspaceRef}
              variant="modal"
              onClose={() => onOpenChange(false)}
              renderTitle={(title) => (
                <Dialog.Title className="dsc-title" asChild>
                  <h2>{title}</h2>
                </Dialog.Title>
              )}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  },
);
