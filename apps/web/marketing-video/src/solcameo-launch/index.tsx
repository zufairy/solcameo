import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {SolcameoLaunch} from './Launch';
const Root=()=> <Composition id="SolcameoLaunch" component={SolcameoLaunch} durationInFrames={900} fps={30} width={1080} height={1920}/>;
registerRoot(Root);
