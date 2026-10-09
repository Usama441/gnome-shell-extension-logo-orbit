#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Turn a GNOME screen recording (.webm/.mp4) into a looping README GIF.

Usage: tools/make-demo-gif.py RECORDING [OUTPUT] [--width 720] [--fps 15]
                              [--start SECONDS] [--end SECONDS]

Needs GStreamer (gst-launch-1.0) and Pillow, both preinstalled on Ubuntu.
"""

import argparse
import pathlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('recording', type=pathlib.Path)
    p.add_argument('output', type=pathlib.Path, nargs='?', default=pathlib.Path('docs/demo.gif'))
    p.add_argument('--width', type=int, default=720, help='GIF width in pixels (height keeps the aspect ratio)')
    p.add_argument('--fps', type=int, default=15)
    p.add_argument('--start', type=float, default=0, help='skip this many seconds at the start')
    p.add_argument('--end', type=float, default=None, help='stop at this many seconds')
    args = p.parse_args()

    if not args.recording.is_file():
        sys.exit(f'No such file: {args.recording}')
    if not shutil.which('gst-launch-1.0'):
        sys.exit('gst-launch-1.0 not found (install gstreamer1.0-tools)')

    with tempfile.TemporaryDirectory() as tmp:
        # Decode, resample to a steady frame rate, scale down and dump PNG frames.
        subprocess.run([
            'gst-launch-1.0', '-q',
            'filesrc', f'location={args.recording.resolve()}', '!', 'decodebin', '!',
            'videoconvert', '!', 'videorate', '!', 'videoscale', '!',
            f'video/x-raw,format=RGB,framerate={args.fps}/1,width={args.width},pixel-aspect-ratio=1/1', '!',
            'pngenc', '!', 'multifilesink', f'location={tmp}/%05d.png',
        ], check=True)

        frames = sorted(pathlib.Path(tmp).glob('*.png'))
        first = round(args.start * args.fps)
        last = round(args.end * args.fps) if args.end is not None else len(frames)
        frames = frames[first:last]
        if not frames:
            sys.exit('No frames in the chosen range')

        # One shared palette, built from frames across the whole clip, keeps
        # colours steady (no flicker) and the file small.
        sample = [Image.open(f).convert('RGB') for f in frames[::max(1, len(frames) // 12)]]
        strip = Image.new('RGB', (sample[0].width, sample[0].height * len(sample)))
        for i, im in enumerate(sample):
            strip.paste(im, (0, i * im.height))
        palette = strip.quantize(colors=255, method=Image.Quantize.MEDIANCUT)

        images = [Image.open(f).convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE)
                  for f in frames]
        args.output.parent.mkdir(parents=True, exist_ok=True)
        images[0].save(args.output, save_all=True, append_images=images[1:],
                       duration=round(1000 / args.fps), loop=0, optimize=True, disposal=1)

    size = args.output.stat().st_size / 1e6
    print(f'{args.output}: {len(images)} frames, {images[0].width}x{images[0].height}, {size:.1f} MB')
    if size > 10:
        print('Tip: GitHub shows GIFs up to 10 MB; try a smaller --width, lower --fps or a shorter clip.')


if __name__ == '__main__':
    main()
