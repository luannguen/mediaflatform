declare module 'react-native' {
  import * as React from 'react';

  export interface ImageURISource {
    uri?: string;
    headers?: Record<string, string>;
    cache?: 'default' | 'reload' | 'force-cache' | 'only-if-cached';
  }

  export interface ImageProps {
    source: ImageURISource | number;
    style?: any;
    resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
    onLoad?: () => void;
    onError?: (error: any) => void;
    accessibilityLabel?: string;
  }

  export const Image: React.FC<ImageProps>;
  export const View: React.FC<any>;
  export const StyleSheet: {
    create: <T extends Record<string, any>>(styles: T) => T;
    absoluteFill: any;
  };
}
