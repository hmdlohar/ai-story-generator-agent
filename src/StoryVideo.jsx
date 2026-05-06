import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';

const msToFrames = (ms, fps) => Math.round((ms / 1000) * fps);

const getActiveSegmentIndex = (segments, currentMs) => {
  const foundIndex = segments.findIndex(
    (segment) => currentMs >= segment.start && currentMs < segment.end,
  );

  if (foundIndex !== -1) {
    return foundIndex;
  }

  let lastIndex = 0;
  for (let index = 0; index < segments.length; index += 1) {
    if (currentMs >= segments[index].start) {
      lastIndex = index;
    }
  }

  return lastIndex;
};

export const StoryVideo = ({story}) => {
  const {audioFile, fps, imageFiles, segments} = story;
  const frame = useCurrentFrame();
  const currentMs = (frame / fps) * 1000;
  const activeSegmentIndex = Math.max(0, getActiveSegmentIndex(segments, currentMs));
  const activeSegment = segments[activeSegmentIndex];
  const segmentStartFrame = msToFrames(activeSegment.start, fps);
  const segmentEndFrame = msToFrames(activeSegment.end, fps);
  const imageSrc = staticFile(
    imageFiles[Math.min(activeSegmentIndex, imageFiles.length - 1)],
  );

  const zoom = interpolate(
    frame,
    [segmentStartFrame, segmentEndFrame],
    [1, 1.08],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill style={{backgroundColor: '#0b0b0b'}}>
      <Audio src={staticFile(audioFile)} />

      <AbsoluteFill style={{overflow: 'hidden'}}>
        <Img
          src={imageSrc}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0, 0, 0, 0.12) 0%, rgba(0, 0, 0, 0.5) 72%, rgba(0, 0, 0, 0.8) 100%)',
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          padding: '0 64px 128px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            color: 'white',
            fontSize: 62,
            lineHeight: 1.22,
            fontWeight: 700,
            textAlign: 'center',
            textShadow: '0 6px 24px rgba(0, 0, 0, 0.75)',
            fontFamily:
              '"Noto Sans Devanagari", "Hind", "Kohinoor Devanagari", sans-serif',
          }}
        >
          {activeSegment.text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
