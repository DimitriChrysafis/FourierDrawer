from PIL import Image
import os


def rF(iP, n, m):
    g = Image.open(iP)
    f = []

    # Get the original file size
    orig_size = os.path.getsize(iP)
    print(f"Original file size: {orig_size} bytes")

    try:
        while True:
            f.append(g.copy())
            g.seek(len(f))
    except EOFError:
        pass

    sF = []
    for i in range(len(f)):
        if (i % (n + m)) < n:
            sF.append(f[i])

    if sF:
        sF[0].save(
            iP,
            save_all=True,
            append_images=sF[1:],
            loop=0,
            duration=g.info.get('duration', 100) // 2
        )

    new_size = os.path.getsize(iP)
    print(f"New file size: {new_size} bytes")


inputGifPath = '/Users/dimitrichrysafis/Desktop/py/VIDEO_urv95kewmbl08h1a_compressed_cropped_sped_up.gif'
n = 1  # KEEP
m = 2  # REMOVE

rF(inputGifPath, n, m)
