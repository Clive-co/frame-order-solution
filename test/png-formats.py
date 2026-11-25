# Writes PNGs in many formats (palette, gray, 16-bit, alpha, interlaced) plus the
# expected RGB, so test/png-formats.js can check our decoder against PIL.
import numpy as np, os, sys
from PIL import Image
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(0)
base = (rng.random((37, 53, 3)) * 255).astype(np.uint8)
base[:, :20] = base[:, :1]  # some flat area so filters differ
cases = {
  'rgb': Image.fromarray(base),
  'rgba': Image.fromarray(np.dstack([base, (rng.random((37,53))*255).astype(np.uint8)]), 'RGBA'),
  'gray': Image.fromarray(base[..., 0], 'L'),
  'la': Image.fromarray(np.dstack([base[...,0], base[...,1]]), 'LA'),
  'pal': Image.fromarray(base).convert('P', palette=Image.ADAPTIVE, colors=16),
  'bw': Image.fromarray(base[...,0]).convert('1'),
  'gray16': Image.fromarray((base[...,0].astype(np.uint16) * 257)),
}
for name, im in cases.items():
    im.save(f'{out}/{name}.png')
    im.save(f'{out}/{name}_interlaced.png', interlace=1) if name not in ('gray16',) else None
    # expected: PIL's RGB conversion, alpha composited over black
    if im.mode in ('RGBA', 'LA'):
        a = np.array(im.getchannel('A')).astype(float) / 255
        rgb = np.array(im.convert('RGB')).astype(float) * a[..., None]
    elif im.mode == 'I;16':
        rgb = np.dstack([np.array(im) >> 8] * 3).astype(float)
    else:
        rgb = np.array(im.convert('RGB')).astype(float)
    np.save(f'{out}/{name}.npy', rgb)
    if os.path.exists(f'{out}/{name}_interlaced.png'): np.save(f'{out}/{name}_interlaced.npy', rgb)
