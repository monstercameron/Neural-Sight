# SuperSplat collision runtime

`collision.ts` and `voxel-collision.ts` are unmodified MIT-licensed PlayCanvas sources, pinned to commit `86ef7fcd6d70ac50e342a198cc683a393b8cdbc8` from https://github.com/playcanvas/supersplat-viewer/tree/86ef7fcd6d70ac50e342a198cc683a393b8cdbc8/src/collision . See LICENSE.

The local controller uses the 1.1 world-space voxel dataset without an additional rotation. Only the visual splat gets the source-to-engine 180° Z rotation.
