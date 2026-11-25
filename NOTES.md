# Notes

## Approach

Consecutive frames of a video look alike, so I treat ordering as finding the shortest
path through all frames, where "distance" is how different two frames look.

1. **Decode** PNGs with a small dependency-free decoder (`src/png.js`: all colour types
   and bit depths, palettes, alpha, Adam7). Nothing to install, so the offline build and
   `--network none` can't break. Decoding runs on worker threads when there are several cores.
2. **Features**: each frame is box-downsampled to a small RGB grid (at most 48x48; smaller for
   long videos so the O(n^2) comparison stays at a few seconds).
3. **Distance**: Euclidean distance between frames at several scales (a pyramid of 2x2
   averages), each scale normalised by its median and summed, then squared. The coarse scales
   keep fast-moving things "close" even when they no longer overlap between frames; squaring
   makes one big jump cost more than several small steps.
4. **Path**: open-path travelling salesman. Greedy-edge construction, then 2-opt and Or-opt,
   then a short iterated local search. (An open path is a cycle through a dummy city that is
   at distance 0 from everything.)
5. **Direction**: a path reads equally well forwards or backwards, so I pick the end that is
   darker as the start (more videos fade in than out).

Every `.png` in the directory is printed exactly once. A frame that fails to decode (or has a
different size) is appended at the end rather than dropped.

## How I tested

No real videos were available, so `test/make-videos.py` generates shuffled synthetic videos
(bouncing balls, camera pans, a still intro, fades, noise) and `test/score.js` scores the output.
`test/png-formats.*` checks the decoder against PIL on 13 PNG variants. `examples/digits` comes
out as 1,2,3,4,5. On moving-content videos (300 frames, noisy or clean) every adjacent pair is correct.

## Where it still goes wrong

- **Direction is mostly a guess.** Nothing in pixel content says which way time runs, apart
  from fades. Expect about half of the videos to come out reversed if the score cares.
- **Frames that are identical up to noise** (a still shot, the eased start/end of a pan) have
  no recoverable order; they come out shuffled within the run.
- **Motion that returns to the same picture** (a pendulum, a loop) makes frame t and frame
  n-t indistinguishable.
- **Motion bigger than the object between frames**: the multi-scale distance helps (3% -> ~18% on my
  worst synthetic case) but it is still weak.
- **Scene cuts**: each shot is ordered well, but which shot follows which is close to a guess.
- **Speed**: the distance matrix is n x n floats, fine up to a few thousand frames. 1000 frames
  of 128x96 takes ~7s on one core; large frames cost about 0.1s each to decode.
- Ideas I did not get to: optical-flow based direction cues (gravity, zoom in vs out), detecting
  shot boundaries explicitly, and learning a frame-similarity metric from real videos.
