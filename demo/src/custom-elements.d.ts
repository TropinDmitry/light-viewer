// Чтобы TypeScript в JSX знал про тег <luminaire-viewer> и его атрибуты.
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { LuminaireViewerElement } from '../../src/element';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'luminaire-viewer': DetailedHTMLProps<HTMLAttributes<LuminaireViewerElement>, LuminaireViewerElement> & {
        class?: string;
        [attribute: string]: unknown;
      };
    }
  }
}
