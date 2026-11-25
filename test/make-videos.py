# Generates shuffled synthetic videos + ground truth for scoring.
#   python3 make-videos.py OUT_DIR
# Each video -> OUT/<name>/frames/<random>.png and OUT/<name>/truth.txt (true order).
import numpy as np, os, sys, secrets
from PIL import Image
from scipy.ndimage import gaussian_filter, shift as ndshift
W, H = 128, 96
rng = np.random.default_rng(42)

def texture(h, w, seed):
    r = np.random.default_rng(seed)
    t = sum(gaussian_filter(r.random((h, w, 3)), (s, s, 0), mode='wrap') * (s ** 0.8) for s in (2, 5, 12, 30))
    t -= t.min(); return t / t.max()

NOISE = 2.0
def noise(f, sigma=None):
    sigma = NOISE if sigma is None else sigma
    return np.clip(f * 255 + rng.normal(0, sigma, f.shape), 0, 255).astype(np.uint8)

def noisy(fn, s):
    global NOISE
    NOISE = s
    try: return fn()
    finally: NOISE = 2.0

def balls(n, speed=1.0):
    yy, xx = np.mgrid[:H, :W]
    grad = np.dstack([xx / W * .5 + .2, yy / H * .4 + .3, np.full((H, W), .6)])
    st = [(rng.random(2) * [W, H], (rng.random(2) - .5) * 6 * speed, rng.random(3), 6 + rng.random() * 6) for _ in range(4)]
    frames = []
    for t in range(n):
        f = grad.copy()
        for p, v, col, r in st:
            c = p + v * t
            c = np.abs(((c + [W, H]) % (2 * np.array([W, H]))) - [W, H])  # bounce
            m = (xx - c[0]) ** 2 + (yy - c[1]) ** 2 < r * r
            f[m] = col
        frames.append(noise(f))
    return frames

def pan(n, speed=1.0, ease=True):
    T = texture(H, W * 8, 1)
    frames = []
    for t in range(n):
        u = t / max(1, n - 1)
        u = (0.5 - 0.5 * np.cos(np.pi * u)) if ease else u
        x = int(u * (W * 8 - W - 1) * min(1, speed))
        frames.append(noise(T[:, x:x + W]))
    return frames

def pause(n):
    T = texture(H, W, 3); frames = []
    for t in range(n):
        u = 0 if t < n // 3 else (t - n // 3) / (n - n // 3)  # long still intro then motion
        f = ndshift(T, (u * 20, u * 35, 0), mode='wrap', order=1)
        frames.append(noise(f, 1.5))
    return frames

def fade(n):
    fr = balls(n, 0.6)
    return [(f * min(1, 3 * t / n)).astype(np.uint8) for t, f in enumerate(fr)]

def oscillate(n):
    T = texture(H, W * 3, 5); frames = []
    for t in range(n):
        x = int((np.sin(2 * np.pi * t / n * 1.0) * .5 + .5) * (W * 2 - 2))
        frames.append(noise(T[:, x:x + W]))
    return frames

def fastsmall(n):
    yy, xx = np.mgrid[:H, :W]; bg = texture(H, W, 9) * .5; frames = []
    for t in range(n):
        f = bg.copy(); cx = (t * 11) % W; cy = (t * 7) % H
        f[(xx - cx) ** 2 + (yy - cy) ** 2 < 25] = [1, 1, 0]
        frames.append(noise(f))
    return frames

SCENES = {
    'balls_60': lambda: balls(60), 'balls_300': lambda: balls(300),
    'pan_300': lambda: pan(300), 'pan_1000': lambda: pan(1000),
    'pause_200': lambda: pause(200), 'fade_200': lambda: fade(200),
    'balls_noisy_300': lambda: noisy(lambda: balls(300, 0.5), 25), 'pan_noisy_300': lambda: noisy(lambda: pan(300, ease=False), 25),
    'oscillate_150': lambda: oscillate(150), 'fastsmall_100': lambda: fastsmall(100),
}
out = sys.argv[1]
for name, fn in SCENES.items():
    frames = fn(); n = len(frames)
    names = [secrets.token_hex(4) for _ in range(n)]
    d = f'{out}/{name}'; os.makedirs(f'{d}/frames', exist_ok=True)
    for nm, f in zip(names, frames): Image.fromarray(f).save(f'{d}/frames/{nm}.png')
    open(f'{d}/truth.txt', 'w').write('\n'.join(n_ + '.png' for n_ in names) + '\n')
    print(name, n)
