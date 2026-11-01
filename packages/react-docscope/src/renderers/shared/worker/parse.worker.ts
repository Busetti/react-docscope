/// <reference lib="webworker" />
import { createParseHandler, type ParseRequest } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = createParseHandler((msg) => scope.postMessage(msg));
scope.onmessage = (event: MessageEvent<ParseRequest>) => handle(event.data);
