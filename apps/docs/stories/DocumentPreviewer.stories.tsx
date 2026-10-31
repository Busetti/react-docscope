import type { Meta, StoryObj } from '@storybook/react-vite';
import { DocumentPreviewer } from 'react-docscope';
import { allSamples, failing, samples, urlResolver } from './docs';

const meta = {
  title: 'Components/DocumentPreviewer',
  component: DocumentPreviewer,
  args: { resolver: urlResolver, config: { height: 640 } },
  argTypes: {
    documents: { control: false },
    document: { control: false },
    resolver: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Inline previewer. One document or many (attachments sidebar, navigation, compare).',
      },
    },
  },
} satisfies Meta<typeof DocumentPreviewer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AllFormats: Story = { args: { documents: allSamples } };
export const SinglePdf: Story = { args: { document: samples.pdf } };
export const Word: Story = { args: { document: samples.docx } };
export const PowerPoint: Story = { args: { document: samples.pptx } };
export const Excel: Story = { args: { document: samples.xlsx } };
export const Csv: Story = { args: { document: samples.csv } };
export const Markdown: Story = { args: { document: samples.md } };
export const Json: Story = { args: { document: samples.json } };
export const Xml: Story = { args: { document: samples.xml } };
export const Image: Story = { args: { document: samples.image } };
export const Video: Story = { args: { document: samples.video } };
export const DarkTheme: Story = {
  args: { documents: allSamples, config: { theme: 'dark', height: 640 } },
};
export const Compare: Story = {
  args: { documents: [samples.pdf, samples.xlsx, samples.docx], defaultCompare: ['pdf', 'xlsx'] },
};
export const ErrorStates: Story = { args: { documents: failing } };
export const Minimal: Story = {
  args: {
    document: samples.md,
    config: { toolbar: false, metadata: false, fullscreen: false, download: false, height: 400 },
  },
};
