# Solcameo — The Cameo Era (Three.js rebuild)

30-second 1920 × 1080 launch film, 16:9, 30 fps, H.264 + stereo AAC.

True Three.js scenes rendered through React Three Fiber and Remotion ThreeCanvas: beveled glossy star characters, solid token coins with raised faces and edge ridges, floating physical cards, environment reflections, orbital motion and a frame-controlled camera. All animation is deterministic and tied to the video timeline.

Uses the original Solcameo logo and the original synthesized launch score. Character cards and the AI-video scene are illustrative motion graphics.

Narrative: Your next main character → Tag anyone → Make it a video → Launch the token → Be the one who made it → solcameo.com.

Render from marketing-video:

    npx remotion render src/solcameo-launch-3d/index.tsx SolcameoLaunch3D out/solcameo-launch-3d/solcameo-launch-3d-16x9.mp4 --codec h264 --crf 18 --color-space bt709 --pixel-format yuv420p --concurrency 3 --gl angle --audio-bitrate 320k

Dependencies used: Remotion / @remotion/three / @remotion/media 4.0.533; @react-three/fiber 8.18.0; three 0.170.0; React 18.
