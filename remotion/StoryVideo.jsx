import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const fadeFrames = 18;

function Scene({ scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrame = Math.round((scene.startMs / 1000) * fps);
  const endFrame = Math.round((scene.endMs / 1000) * fps);
  const sceneFrame = frame - startFrame;
  const durationInFrames = Math.max(1, endFrame - startFrame);
  const zoom = interpolate(sceneFrame, [0, durationInFrames], [1, 1.08], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(
    interpolate(sceneFrame, [0, fadeFrames], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    interpolate(sceneFrame, [durationInFrames - fadeFrames, durationInFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  return (
    <Sequence from={startFrame} durationInFrames={durationInFrames}>
      <AbsoluteFill style={{ backgroundColor: '#111' }}>
        <Img
          src={staticFile(scene.imageSrc)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity,
            transform: `scale(${zoom})`,
          }}
        />
      </AbsoluteFill>
    </Sequence>
  );
}

export function StoryVideo({ audioSrc, scenes = [] }) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#111' }}>
      {scenes.map((scene, index) => (
        <Scene key={`${scene.startMs}-${index}`} scene={scene} />
      ))}
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
    </AbsoluteFill>
  );
}
