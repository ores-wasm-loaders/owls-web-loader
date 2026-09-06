// A completion-based bridge for a native host embedding this loader in a WebView.
//
// The native side receives completion, never runtime objects, and every request must name the
// exact document it was issued against: a WebView that navigated between the request and its
// arrival must not have someone else's activation applied to it.
import { LoaderError } from './contract.mjs';

export function createWebViewBridge(coordinator, adapters, currentDocument, reply) {
  return Object.freeze({
    receive(input) {
      const request = input;
      const valid =
        request &&
        typeof request === 'object' &&
        Object.keys(request).sort().join(',') === 'document,method,releaseKey,requestId' &&
        typeof request.requestId === 'string' &&
        /^[0-9]{1,16}$/.test(request.requestId) &&
        typeof request.releaseKey === 'string' &&
        request.releaseKey.length <= 256 &&
        request.document === currentDocument() &&
        ['prefetch', 'activate'].includes(request.method);
      if (!valid) throw new LoaderError('bridge', 'Invalid bridge request or stale document');

      const operation = async () => {
        if (request.method === 'prefetch') {
          await coordinator.prefetch(request.releaseKey);
        } else {
          const adapter = adapters.get(request.releaseKey);
          if (!adapter) throw new LoaderError('bridge', 'No activation adapter registered for this release');
          await coordinator.activate(request.releaseKey, adapter);
        }
      };
      void operation().then(
        () => reply(JSON.stringify({ requestId: request.requestId, ok: true })),
        () => reply(JSON.stringify({ requestId: request.requestId, ok: false })),
      );
    },
  });
}
