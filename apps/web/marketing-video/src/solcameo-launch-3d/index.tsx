import React from 'react';
import {Composition,registerRoot} from 'remotion';
import {Film} from './Film';
registerRoot(()=> <Composition id="SolcameoLaunch3D" component={Film} durationInFrames={900} fps={30} width={1920} height={1080}/>);
