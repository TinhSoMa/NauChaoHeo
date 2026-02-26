import React from 'react';
import styles from './CutVideo.module.css';
import { AudioExtractor } from './AudioExtractor';
import { VideoSplitter } from './VideoSplitter';

export const CutVideo: React.FC = () => {
  return (
    <div className={styles.container}>
      <AudioExtractor />
      <VideoSplitter />
    </div>
  );
};
