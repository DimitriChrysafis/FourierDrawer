import os
from tqdm import tqdm
from PIL import Image, ImageDraw
from fourier_logic import FourierTransform
import numpy as np
from concurrent.futures import ThreadPoolExecutor
import threading
from numba import njit
import os, shutil; [shutil.rmtree('folder') if os.path.exists('folder') else None, os.makedirs('folder')]



class FourierDrawingMachine:
    def __init__(self, points, highRes=True, speed=1, opacity=1.0):
        self.points = points
        self.pathOrder = FourierTransform.nearestNeighborOrder(self.points)
        self.orderedPoints = self.points[self.pathOrder]
        self.complexPoints = self.orderedPoints[:, 0] + 1j * self.orderedPoints[:, 1]
        self.fourierCoeffs = FourierTransform.dft(self.complexPoints)
        self.totalFrames = len(self.points) * 100
        self.speed = speed

        self.imageSize = (9000, 9000) if highRes else (2000, 2000)
        self.opacity = int(opacity * 255)
        self.output_dir = "/Users/dimitrichrysafis/Desktop/Anim/"
        os.makedirs(self.output_dir, exist_ok=True)

        self.center, self.squareSize = self.calculateBoundingBox()
        self.trailX = []
        self.trailY = []
        self.lock = threading.Lock()

        self.scale = min(self.imageSize) / (2 * self.squareSize)
        self.centerShift = np.array(self.imageSize) // 2

    def calculateBoundingBox(self):
        center = np.mean(self.orderedPoints, axis=0)
        distances = np.linalg.norm(self.orderedPoints - center, axis=1)
        maxDistance = np.max(distances) * 1.5  # scale factor for the bounding box incase u pick bad points
        return center, maxDistance

    @staticmethod
    @njit
    def drawArmsStatic(arms, centerShift, scale):
        lines = []
        prev = (centerShift[0], centerShift[1])
        for arm in arms:
            current = (int(arm.real * scale + centerShift[0]),
                       int(arm.imag * scale + centerShift[1]))
            lines.append((prev, current))
            prev = current
        return lines

    def drawCircles(self, draw, arms):
        for i in range(1, len(arms)):
            radius = int(np.abs(self.fourierCoeffs[i - 1]) * self.scale)
            if radius > 0:
                center = (int(arms[i - 1].real * self.scale + self.centerShift[0]),
                          int(arms[i - 1].imag * self.scale + self.centerShift[1]))
                draw.ellipse([center[0] - radius, center[1] - radius,
                               center[0] + radius, center[1] + radius],
                             # COMMENT FOR MYSELF SO I CAN COMMAND SEARCH FOR COMMENTS
                             # I JUST WANT TO EASILY BE ABLE TO EDIT THE WIDTH OF SOME SHAPES
                             # COLOR EDITOR
                             outline=(102, 204, 102), width=2)

    def drawTrail(self, draw):
        for i in range(1, len(self.trailX)):
            draw.line([(self.trailX[i - 1], self.trailY[i - 1]),
                        (self.trailX[i], self.trailY[i])],
                      ### AHHHHH PURPLE
                       fill=(0, 0, 255), width=4)

    def update(self, frame):
        img = Image.new('RGB', self.imageSize, (255, 255, 255))
        draw = ImageDraw.Draw(img)
        t = (frame / (self.totalFrames / self.speed)) % 1.0
        arms = FourierTransform.fourierSeries(t, self.fourierCoeffs)

        lines = self.drawArmsStatic(arms, self.centerShift, self.scale)
        for prev, current in lines:
            draw.line([prev, current], fill=(0, 102, 204), width=0)

        self.drawCircles(draw, arms)
        endPoint = (int(arms[-1].real * self.scale + self.centerShift[0]),
                    int(arms[-1].imag * self.scale + self.centerShift[1]))
        draw.ellipse([endPoint[0] - 4, endPoint[1] - 4,
                       endPoint[0] + 4, endPoint[1] + 4],
                      fill=(255, 153, 51))

        with self.lock:
            self.trailX.append(endPoint[0])
            self.trailY.append(endPoint[1])
            self.drawTrail(draw)

        img.save(os.path.join(self.output_dir, f'frame_{frame:08d}.jpg'), "JPEG")

    def saveFrames(self):
        totalFramesAdjusted = int(self.totalFrames / self.speed)
        # Threadpool thing for parralelization of saving so it saves faster
        # im unsure how to get the usemaxthreads anyway
        with ThreadPoolExecutor(max_workers=14) as executor:
            # ur computer might be bad but i have 14 super powerful threads just lower it if u cant handle the energy
            list(tqdm(executor.map(self.update, range(totalFramesAdjusted)),
                       total=totalFramesAdjusted, desc="Saving frames"))

if __name__ == '__main__':
    import json

    with open('points.json', 'r') as f:
        data = json.load(f)

    points = np.array(data['points'])
    machine = FourierDrawingMachine(points, highRes=True, speed=100)
    # Modify speed as you wish to be able to have precision be higher or lower
    # lower speed higher accuracy

    machine.saveFrames()

    import subprocess;

    subprocess.run(['python', 'intovid.py'])
