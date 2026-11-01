/**
 * Lightweight pdf.js stand-in for jsdom (no canvas / workers). Real rendering
 * is covered by the Playwright suite; this mock lets unit tests exercise the
 * renderer's state machine, layout, search and error handling.
 */
export interface MockPdfOptions {
  numPages?: number;
  pageText?: (page: number) => string[];
  fail?: { name: string; message?: string; status?: number } | null;
  width?: number;
  height?: number;
  /** Simulate an encrypted PDF: `onPassword` is called until this password is supplied. */
  password?: string;
}

const state: { options: MockPdfOptions; calls: Array<Record<string, unknown>>; destroyed: number } =
  {
    options: {},
    calls: [],
    destroyed: 0,
  };

export function __setMockPdf(options: MockPdfOptions): void {
  state.options = options;
  state.calls = [];
  state.destroyed = 0;
}

export function __mockPdfState() {
  return state;
}

export const GlobalWorkerOptions: { workerSrc: string; workerPort: unknown } = {
  workerSrc: '',
  workerPort: null,
};
export const version = 'mock';

class Viewport {
  constructor(
    public width: number,
    public height: number,
    public scale: number,
    public rotation: number,
  ) {}
  convertToViewportPoint(x: number, y: number): number[] {
    return [x * this.scale, this.height - y * this.scale];
  }
}

function makePage(n: number) {
  const o = state.options;
  const w = o.width ?? 612;
  const h = o.height ?? 792;
  const lines = o.pageText?.(n) ?? [`Page ${n} text with invoice`];
  return {
    rotate: 0,
    getViewport: ({ scale, rotation = 0 }: { scale: number; rotation?: number }) => {
      const rotated = Math.abs(rotation % 180) === 90;
      return new Viewport((rotated ? h : w) * scale, (rotated ? w : h) * scale, scale, rotation);
    },
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
    getTextContent: async () => ({
      items: lines.map((str, i) => ({
        str,
        transform: [12, 0, 0, 12, 72, h - 72 - i * 20],
        width: str.length * 6,
        height: 12,
        hasEOL: true,
      })),
    }),
    cleanup: () => true,
  };
}

export const PasswordResponses = { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 };

export function getDocument(params: Record<string, unknown>) {
  state.calls.push(params);
  const o = state.options;
  const doc = { numPages: o.numPages ?? 3, getPage: async (n: number) => makePage(n) };
  const task: {
    promise: Promise<typeof doc>;
    destroy: () => Promise<void>;
    onPassword?: (update: (password: string) => void, reason: number) => void;
  } = {
    promise: Promise.resolve(doc),
    destroy: async () => {
      state.destroyed += 1;
    },
  };
  if (o.fail) {
    task.promise = Promise.reject(
      Object.assign(new Error(o.fail.message ?? o.fail.name), {
        name: o.fail.name,
        status: o.fail.status,
      }),
    );
  } else if (o.password !== undefined) {
    task.promise = new Promise((resolve, reject) => {
      const update = (password: string) => {
        if (password === o.password) resolve(doc);
        else setTimeout(() => ask(PasswordResponses.INCORRECT_PASSWORD), 0);
      };
      const ask = (reason: number) => {
        if (task.onPassword) task.onPassword(update, reason);
        else reject(Object.assign(new Error('No password given'), { name: 'PasswordException' }));
      };
      setTimeout(() => ask(PasswordResponses.NEED_PASSWORD), 0);
    });
  }
  return task;
}

export class TextLayer {
  private container: HTMLElement;
  private items: Array<{ str: string }>;
  constructor({
    textContentSource,
    container,
  }: {
    textContentSource: { items: Array<{ str: string }> };
    container: HTMLElement;
  }) {
    this.container = container;
    this.items = textContentSource.items;
  }
  async render(): Promise<void> {
    for (const item of this.items) {
      const span = document.createElement('span');
      span.textContent = item.str;
      this.container.appendChild(span);
    }
  }
  cancel(): void {}
}

export const WorkerMessageHandler = {};
