import {Composition} from 'remotion';
import {StoryVideo} from './StoryVideo';
import story from '../data/remotion-manifest.json';

const durationInFrames = Math.ceil(story.audioDurationInSeconds * story.fps);

export const RemotionRoot = () => {
  return (
    <Composition
      id="StoryVideo"
      component={StoryVideo}
      durationInFrames={durationInFrames}
      fps={story.fps}
      width={story.width}
      height={story.height}
      defaultProps={{story}}
    />
  );
};
