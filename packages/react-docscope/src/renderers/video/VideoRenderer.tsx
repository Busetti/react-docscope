import { useEffect, useRef } from 'react';
import type { RendererProps } from '../../types';
import { toPreviewError } from '../../core/errors';
import { useAsync } from '../shared/hooks';

/** Native HTML5 video: playback, seeking, volume, fullscreen and PiP come from browser controls. */
export default function VideoRenderer({ document, source, host }: RendererProps) {
  const { value: url, error } = useAsync(() => source.getUrl(), [source]);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (error) {
      const e = toPreviewError(error, 'FETCH_FAILED');
      host.setError(e.code, e.message);
    }
  }, [error, host]);

  // Stop playback and release the network connection on unmount / document switch.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video) return;
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        /* jsdom / detached element */
      }
    };
  }, [url]);

  if (!url) return null;
  return (
    <div className="dsc-video" data-dsc-scroll-container="">
      <video
        ref={videoRef}
        src={url}
        controls
        playsInline
        preload="metadata"
        aria-label={document.name}
        onLoadedMetadata={() => host.setReady()}
        onError={() =>
          host.setError(
            'RENDER_FAILED',
            'This video could not be played. The format may not be supported by your browser.',
          )
        }
      >
        <track kind="captions" />
      </video>
    </div>
  );
}
