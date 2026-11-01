import {
  createParseHandler,
  type ParseRequest,
  type ParseResponse,
} from '../../packages/react-docscope/src/renderers/shared/worker/protocol';

/**
 * In-process stand-in for the inline parse worker. Messages are delivered
 * asynchronously like a real worker. Tests steer it via `FakeParseWorker.mode`.
 */
export default class FakeParseWorker {
  static mode: 'ok' | 'throw' | 'crash' = 'ok';
  static instances: FakeParseWorker[] = [];
  static posted: ParseRequest[] = [];
  onmessage: ((e: { data: ParseResponse }) => void) | null = null;
  onerror: ((e: { preventDefault(): void }) => void) | null = null;
  terminated = false;
  private handle = createParseHandler((msg) => {
    if (this.terminated) return;
    setTimeout(() => !this.terminated && this.onmessage?.({ data: msg }), 0);
  });

  constructor() {
    if (FakeParseWorker.mode === 'throw') throw new Error('Workers blocked by CSP');
    FakeParseWorker.instances.push(this);
  }

  postMessage(req: ParseRequest) {
    FakeParseWorker.posted.push(req);
    if (FakeParseWorker.mode === 'crash') {
      setTimeout(() => this.onerror?.({ preventDefault: () => undefined }), 0);
      return;
    }
    setTimeout(() => !this.terminated && this.handle(req), 0);
  }

  terminate() {
    this.terminated = true;
  }
}
