import numpy as np
from scipy.spatial.distance import cdist

class FourierTransform:
    @staticmethod
    def dft(points):
        N = len(points)
        fourierCoeffs = np.zeros(N, dtype=np.complex64)
        for k in range(-N // 2, N // 2):
            sumValue = 0
            for n in range(N):
                sumValue += points[n] * np.exp(-2j * np.pi * k * n / N)
            fourierCoeffs[k + N // 2] = sumValue / N
        return fourierCoeffs

    @staticmethod
    def fourierSeries(t, coeffs):
        N = len(coeffs)
        pos = 0
        arms = []
        for k in range(N):
            freq = k - N // 2
            pos += coeffs[k] * np.exp(2j * np.pi * freq * t)
            arms.append(pos)
        return arms

    @staticmethod
    def nearestNeighborOrder(points):
        distMatrix = cdist(points, points)
        N = len(points)
        visited = np.zeros(N, dtype=bool)
        path = [0]
        visited[0] = True
        for _ in range(1, N):
            lastPoint = path[-1]
            unvisited = np.where(~visited)[0]
            nextPoint = unvisited[np.argmin(distMatrix[lastPoint, unvisited])]
            path.append(nextPoint)
            visited[nextPoint] = True
        return np.array(path)
