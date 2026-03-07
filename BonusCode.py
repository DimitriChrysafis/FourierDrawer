import matplotlib.pyplot as plt
import matplotlib.animation as animation
import subprocess
import pyglet
import json
import numpy as np
from shapely.geometry import Polygon, Point


# i regret writing so much

## OLD CODE
## SUPER OLD CODE
def remakePath(coefficients, numCoeffs, interpolation=1.0):

    numPoints = len(coefficients)
    remadePath = np.zeros((numPoints, 2), dtype=float)

    # Determine the lower and upper limits of coefficients to use
    coeffsFloor = int(numCoeffs)  # Number of coefficients to fully use
    coeffsCeil = coeffsFloor + 1  # Next coefficient to partially use
    interpol = numCoeffs - coeffsFloor  # Fractional part for interpolation

    for i in range(numPoints):
        point = np.zeros(2, dtype=complex)

        # sum contributions from the floor number of coefficients
        for k in range(coeffsFloor):
            # compute angles for forward and backward coefficients
            w1 = 2 * np.pi * k * i / numPoints
            w2 = 2 * np.pi * (numPoints - 1 - k) * i / numPoints
            # add contributions from forward and backward frequencies
            point += (1 - interpol) * (
                coefficients[k] * np.exp(1j * w1) / numPoints +
                coefficients[numPoints - 1 - k] * np.exp(1j * w2) / numPoints
            )

        # sum contributions from the ceiling number of coefficients
        for k in range(coeffsCeil):
            # cmpute angles for forward and backward coefficients
            w1 = 2 * np.pi * k * i / numPoints
            w2 = 2 * np.pi * (numPoints - 1 - k) * i / numPoints
            # add contributions from forward and backward frequencies
            point += interpol * (
                coefficients[k] * np.exp(1j * w1) / numPoints +
                coefficients[numPoints - 1 - k] * np.exp(1j * w2) / numPoints
            )

        remadePath[i] = point.real  # Store the real part of the reconstructed point

    return remadePath




class PointDrawer:
    def __init__(self, windowWidth=1000, windowHeight=1000):
        """
        Truly nothing special. No different from a normal whiteboard. If you stare hard enough at anything here
        you should be able to find out what it does. Only slightly weird thing here is shapely stuff.
        """
        self.window = pyglet.window.Window(windowWidth, windowHeight, "(Púca)")
        self.points = []
        self.width = windowWidth
        self.height = windowHeight
        self.batch = pyglet.graphics.Batch()
        self.shapes = []
        self.backgroundImage = None
        self.autoClicking = False
        self.mouseX = 0
        self.mouseY = 0
        self.drawing = False
        self.tracingMode = False
        self.currentShapePoints = []
        self.trailShapes = []


        self.window.push_handlers(
            on_draw=self.onDraw,
            on_mouse_press=self.mousePress,
            on_mouse_release=self.mouseRelease,
            on_mouse_drag=self.mouseDrag,
            on_mouse_motion=self.onMouseMotion,
            on_key_press=self.keyPressHandler
        )

    def onMouseMotion(self, x, y, dx, dy):
        self.mouseX = x
        self.mouseY = y

    def setBackground(self, imagePath):
        """
        THIS IS IMPORTANT: Scale the image to fit the background scene
        basic scale logic. find extreme dimensions and
        """
        image = pyglet.image.load(imagePath)
        width, height = image.width, image.height
        scaleX = self.width / width
        scaleY = self.height / height
        scale = min(scaleX, scaleY)
        image.width = int(width * scale)
        image.height = int(height * scale)
        self.backgroundImage = image

    def savePoints(self):
        """
        saves the list of points to a json file an closes the shape

        - if the first point is not identical to the last, the method appends the first point to the end.
        - NORMALIZED TO 0,1
        """
        if self.points:
            if self.points[0] != self.points[-1]:
                self.points.append(self.points[0])
        with open('points.json', 'w') as file:
            json.dump(self.points, file, indent=2)
        print(f"{len(self.points)} points saved to 'points.json'.")

    def addPoint(self, position):
        normalizedX = position[0] / self.width
        normalizedY = position[1] / self.height
        if not self.points or self.points[-1] != [normalizedX, normalizedY]:
            self.points.append([normalizedX, normalizedY])
            print(f"Point added: ({normalizedX:.3f}, {normalizedY:.3f})")

    def onDraw(self):
        """
        handles rendering
        """
        self.window.clear()

        # FOR BACKGROUND IMAGE
        if self.backgroundImage:
            self.backgroundImage.blit(0, 0, width=self.width, height=self.height)

        for shape in self.shapes:
            shape.delete()
        self.shapes.clear()

        # draw points as red circles
        for point in self.points:
            screenX = int(point[0] * self.width)
            screenY = int(point[1] * self.height)
            circle = pyglet.shapes.Circle(screenX, screenY, 5, color=(255, 0, 0), batch=self.batch)
            self.shapes.append(circle)

        # draw lines connecting points
        if len(self.points) > 1:
            screenPoints = [
                (int(p[0] * self.width), int(p[1] * self.height)) for p in self.points
            ]
            for i in range(len(screenPoints) - 1):
                line = pyglet.shapes.Line(*screenPoints[i], *screenPoints[i + 1], width=2, color=(0, 0, 255), batch=self.batch)
                self.shapes.append(line)

        # draw current shape trail in tracing mode
        if self.tracingMode and len(self.currentShapePoints) > 1:
            for shape in self.trailShapes:
                shape.delete()
            self.trailShapes.clear()

            for i in range(len(self.currentShapePoints) - 1):
                x1, y1 = self.currentShapePoints[i]
                x2, y2 = self.currentShapePoints[i + 1]
                line = pyglet.shapes.Line(x1, y1, x2, y2, width=2, color=(0, 255, 0), batch=self.batch)
                self.trailShapes.append(line)

        # Draw all batched shapes
        self.batch.draw()

    def mousePress(self, x, y, button, modifiers):
        """
        Handles mouse press events, initiating point addition or shape tracing based on the mode.

        Parameters:
            - x, y: Mouse position in pixel coordinates.
            - button: The mouse button that was pressed (e.g., left-click).
            - modifiers: Modifier keys held during the event.

        - In tracing mode, starts drawing a new shape.
        - Otherwise, adds a point at the clicked location.
        """
        if button == pyglet.window.mouse.LEFT:
            if self.tracingMode:
                self.drawing = True
                self.currentShapePoints = [(x, y)]
            else:
                self.addPoint((x, y))

    def mouseRelease(self, x, y, button, modifiers):
        if button == pyglet.window.mouse.LEFT and self.tracingMode and self.drawing:
            self.drawing = False
            self.currentShapePoints.append((x, y))
            self.fillShape()

    def mouseDrag(self, x, y, dx, dy, buttons, modifiers):
        if self.tracingMode and self.drawing:
            self.currentShapePoints.append((x, y))

    def keyPressHandler(self, symbol, modifiers):
        """
        key bindings:
            - P: Save points and generate an animation and quit
            - K: Load a background image
            - Q: Toggle automatic point placement (auto-clicking)
            - O: Toggle tracing mode for freehand shape drawing
        """
        if symbol == pyglet.window.key.P:
            if self.points:
                self.savePoints()
                path = np.array(self.points)
                Animator.makeAnimation(path)
        elif symbol == pyglet.window.key.K:
            self.setBackground('image.jpg')
        elif symbol == pyglet.window.key.Q:
            self.toggleAutoClicking()
        elif symbol == pyglet.window.key.O:
            self.tracingMode = not self.tracingMode
            mode = "ON" if self.tracingMode else "OFF"
            print(f"Tracing mode: {mode}")

    def toggleAutoClicking(self):
        if self.autoClicking:
            pyglet.clock.unschedule(self.autoClick)
            print("Auto-clicking OOF.")
        else:
            pyglet.clock.schedule_interval(self.autoClick, 0.05)
            print("Auto-clicking ON.")
        self.autoClicking = not self.autoClicking

    def autoClick(self, dt):
        self.addPoint((self.mouseX, self.mouseY))

    def fillShape(self):
        """
        MAKES A GRID AND FILLS A SHAPE
        """
        if len(self.currentShapePoints) < 3:
            print("it's atriangle u clown.")
            return

        # CLOSE IT SO ITS A SHAPE
        if self.currentShapePoints[0] != self.currentShapePoints[-1]:
            self.currentShapePoints.append(self.currentShapePoints[0])

        # make polygon
        polygon = Polygon(self.currentShapePoints)


        x_min, y_min, x_max, y_max = polygon.bounds
        spacing = 15
        grid_points = []

        for x in np.arange(x_min, x_max, spacing):
            for y in np.arange(y_min, y_max, spacing):
                point = Point(x, y)
                if polygon.contains(point):
                    grid_points.append((x, y))

        # Normalize and add to points
        for x, y in grid_points:
            normalizex = x / self.width
            normalizey = y / self.height
            self.points.append([normalizex, normalizey])

        print(f"filled w/{len(grid_points)} points.")

    def run(self):
        pyglet.app.run()

def findCoefficients(path):
    """
    THIS IS ALL DFT DISCRETE FOUEIHDAGKLHFGSDJKHFGSDKJHFGSDKHJFESKUYLYAGEFK AHHHHHHHHHHHHHH
    ITS ALSO OLD CODE
    """
    numPoints = len(path)
    coefficients = np.zeros((numPoints, 2), dtype=complex)

    for k in range(numPoints):
        coefficient = np.zeros(2, dtype=complex)  #
        for i in range(numPoints):
            angle = -2 * np.pi * k * i / numPoints
            coefficient += path[i] * np.exp(1j * angle)
        coefficients[k] = coefficient

    return coefficients



class Animator:
    @staticmethod
    def makeAnimation(path, totalFrames=600):
        """
        MATPLOTLIB WIKI PAGE
        """
        fig, ax = plt.subplots(figsize=(10, 10))
        coefficients = findCoefficients(path)
        ax.plot(path[:, 0], path[:, 1], 'o-', color='none', alpha=0)

        xMin, xMax = path[:, 0].min(), path[:, 0].max()
        yMin, yMax = path[:, 1].min(), path[:, 1].max()
        padding = 0.1
        ax.set_xlim(xMin - padding, xMax + padding)
        ax.set_ylim(yMin - padding, yMax + padding)
        ax.axis('off')  # Hide axes
        ax.set_aspect('equal')
        line, = ax.plot([], [], 'r-', lw=2)

        def init():
            line.set_data([], [])
            return line,

        def animate(frame):
            """
            computes the reconstructed path using an increasing number of
            fourier coefficients and updates the line stuff
            """
            numPoints = len(path)
            maxCoeffs = numPoints // 2  # Maximum number of Fourier coefficients
            t = frame / (totalFrames - 1)  # Normalized frame index

            ## THIS GIVES IT THE SMOOOOOTH
            interpolation = 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2
            numCoeffs = interpolation * maxCoeffs  # Interpolated number of coefficients
            remadePathData = remakePath(coefficients, numCoeffs)
            line.set_data(remadePathData[:, 0], remadePathData[:, 1])  # Update line data
            return line,

        anim = animation.FuncAnimation(
            fig, animate, init_func=init, frames=totalFrames, interval=50, blit=True
        )

        anim.save('video.mp4', writer='ffmpeg', fps=30, dpi=200)
        plt.close(fig)
        print("VIDEO SAVED")

        # i wtole this from internet idk what it do (it opens the video after its done)
        if subprocess.run(["which", "xdg-open"], stdout=subprocess.PIPE).returncode == 0:
            subprocess.run(["xdg-open", 'video.mp4'])
        elif subprocess.run(["which", "open"], stdout=subprocess.PIPE).returncode == 0:
            subprocess.run(["open", 'video.mp4'])


def main():
    #collect points.json
    drawer = PointDrawer()
    drawer.run()

    with open("points.json", "r") as file:
        points = np.array(json.load(file))

    print("RENDERING STARTED")
    Animator.makeanimation(points)

if __name__ == "__main__":
    main()
