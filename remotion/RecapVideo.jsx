import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, staticFile } from 'remotion';

const fill = { width: '100%', height: '100%' };

// footage.mp4 is already cut to the narration timeline, so it just plays from frame 0.
// Vertical: the 16:9 footage sits in the middle over a blurred, cropped copy of itself.
export function RecapVideo({ videoSrc, audioSrc, vertical }) {
  const src = staticFile(videoSrc);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {vertical ? (
        <>
          <OffthreadVideo
            src={src}
            muted
            style={{ ...fill, objectFit: 'cover', filter: 'blur(40px) brightness(0.6)', transform: 'scale(1.1)' }}
          />
          <AbsoluteFill style={{ justifyContent: 'center' }}>
            <OffthreadVideo src={src} muted style={{ width: '100%' }} />
          </AbsoluteFill>
        </>
      ) : (
        <OffthreadVideo src={src} muted style={{ ...fill, objectFit: 'contain' }} />
      )}
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
    </AbsoluteFill>
  );
}
