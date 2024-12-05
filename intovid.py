import os
import subprocess
import random
import time
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm
from PIL import Image, ImageSequence


class V:
    def __init__(self, d, f=30):
        self.d = d
        self.video_name = self.n()
        self.gif_name = self.video_name.replace('.mp4', '.gif')
        self.compressed_gif_name = self.gif_name.replace('.gif', '_compressed.gif')
        self.f = f
        self.l = []
        self._g()

    def n(self):
        return 'VIDEO_' + ''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=16)) + ".mp4"

    def _g(self):
        self.l = [os.path.join(self.d, i) for i in sorted(os.listdir(self.d)) if i.endswith('.jpg')]

    def r(self, w=8):
        start_time = time.time()

        def s(p):
            img = Image.open(p)
            img.save(p, "JPEG")

        with ThreadPoolExecutor(max_workers=w) as e:
            list(tqdm(e.map(s, self.l), total=len(self.l), desc="Processing images"))
        end_time = time.time()
        print(f"took {end_time - start_time:.2f} seconds for JUST PROCCESING")

    def c(self):
        t = len(self.l)
        img = Image.open(self.l[0])
        r = img.size

        cmd = [
            'ffmpeg', '-framerate', str(self.f), '-i',
            os.path.join(self.d, 'frame_%08d.jpg'),
            '-s', f'{r[0]}x{r[1]}', '-vcodec', 'libx264',
            '-pix_fmt', 'yuv420p', '-y', self.video_name
        ]

        start_time = time.time()
        with tqdm(total=t, desc="Creating Video") as pbar:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            for line in iter(p.stdout.readline, b''):
                pbar.update(1)
            p.stdout.close()
            p.wait()
        end_time = time.time()
        print(f" creation took {end_time - start_time:.2f} seconds.")

    def ingif(self):
        cmd = [
            'ffmpeg', '-i', self.video_name,
            '-vf', 'fps=10',
            '-y', self.gif_name
        ]

        start_time = time.time()
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        p.wait()
        end_time = time.time()

        print(f"GIF conversion took {end_time - start_time:.2f}")

    def compressgif(self, scale_factor=0.5):
        cmd = [
            'ffmpeg', '-i', self.gif_name,
            '-vf', f'scale=iw*{scale_factor}:ih*{scale_factor}',
            '-y', self.compressed_gif_name
        ]

        start_time = time.time()
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        p.wait()
        end_time = time.time()

        print(f"Compressed GIF creation {end_time - start_time:.2f}")

    def crop(self, left=0, right=0, top=0, bottom=0):
        with Image.open(self.compressed_gif_name) as img:
            frames = [img.copy() for img in ImageSequence.Iterator(img)]

        cropped_frames = []
        for frame in tqdm(frames, desc="Cropping frames", unit="frame"):
            width, height = frame.size
            bbox = (left, top, width - right, height - bottom)
            cropped_frame = frame.crop(bbox)
            cropped_frames.append(cropped_frame)

        self.savecrop(cropped_frames)
        self.spedgif(cropped_frames) # create stoned/sped gif

    def savecrop(self, frames):
        output_cropped_gif_name = self.compressed_gif_name.replace('.gif', '_cropped.gif')
        frames[0].save(
            output_cropped_gif_name,
            save_all=True,
            append_images=frames[1:],
            duration=100,
            loop=0
        )
        print(f"cropped GIF saved: {output_cropped_gif_name}")

    def spedgif(self, frames, speedfactror=100):
        NAMEEEEE = self.compressed_gif_name.replace('.gif', '_cropped_sped_up.gif')
        SPEDDD = frames
        FRIATIONNNDJHLKDSHFDSJF = 100 // speedfactror

        SPEDDD[0].save(
            NAMEEEEE,
            save_all=True,
            append_images=SPEDDD[1:],
            duration=FRIATIONNNDJHLKDSHFDSJF,
            loop=0
        )
        print(f"sped GIF saved as: {NAMEEEEE}")


if __name__ == '__main__':
    d = "/Users/dimitrichrysafis/Desktop/Anim/"

    v = V(d, f=60)
    v.r(w=16)
    print(f"Output vid: {v.video_name}")
    v.c()
    v.ingif()
    print(f"Output GIF: {v.gif_name}")

    v.compressgif(scale_factor=0.3)
    print(f"Output compressed GIF file: {v.compressed_gif_name}")

    v.crop(left=100, right=100, top=100, bottom=100)
