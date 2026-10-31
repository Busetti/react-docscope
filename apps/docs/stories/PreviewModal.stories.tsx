import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { PreviewModal, useDocumentPreview } from 'react-docscope';
import { allSamples, urlResolver } from './docs';

const meta = { title: 'Components/PreviewModal', component: PreviewModal } satisfies Meta<
  typeof PreviewModal
>;
export default meta;

function ControlledDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open preview</button>
      <PreviewModal
        open={open}
        onOpenChange={setOpen}
        documents={allSamples}
        resolver={urlResolver}
      />
    </>
  );
}

function HookDemo() {
  const { open, compare, PreviewPortal } = useDocumentPreview({
    documents: allSamples,
    resolver: urlResolver,
  });
  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
      {allSamples.map((d) => (
        <button key={d.id} onClick={() => open(d.id)}>
          Preview {d.name}
        </button>
      ))}
      <button onClick={() => compare('pdf', 'docx')}>Compare PDF ↔ DOCX</button>
      <PreviewPortal />
    </div>
  );
}

export const Controlled: StoryObj = { render: () => <ControlledDemo /> };
export const HeadlessHook: StoryObj = { render: () => <HookDemo /> };
