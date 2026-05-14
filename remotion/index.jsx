import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { StoryVideo } from './StoryVideo.jsx';

const fallbackProps = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationMs: 10000,
  audioSrc: '',
  scenes: [],
};

function RemotionRoot() {
  return (
    <Composition
      id="StoryVideo"
      component={StoryVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={fallbackProps}
      calculateMetadata={({ props }) => {
        const fps = props.fps || fallbackProps.fps;
        const width = props.width || fallbackProps.width;
        const height = props.height || fallbackProps.height;
        const durationMs = props.durationMs || fallbackProps.durationMs;

        return {
          fps,
          width,
          height,
          durationInFrames: Math.max(1, Math.ceil((durationMs / 1000) * fps)),
          props,
        };
      }}
    />
  );
}

registerRoot(RemotionRoot);
