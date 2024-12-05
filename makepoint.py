import pygame
import json
import cv2
import numpy as np
import matplotlib.pyplot as plt
from skimage.morphology import skeletonize
from skimage import io, color

# All of this paraphenilia is just

pygame.init()

W, H = 800, 600
CX, CY = W // 2, H // 2
J, I = "points.json", "/Users/dimitrichrysafis/Desktop/image.jpg"
DENSITY = 1

def oiinnit():
    with open(J, 'w') as f:
        json.dump({"points": [], "tracing_mode": False}, f, indent=4)

oiinnit()

def L(): return json.load(open(J))

def S(p): json.dump(p, open(J, 'w'), indent=4)

def A(i,d=1):
    img=io.imread(i)
    if img.shape[2]==4:
        img=img[:,:,:3]
    gray_img=color.rgb2gray(img)
    edges=cv2.Canny((gray_img*255).astype(np.uint8),100,200)
    skeleton=skeletonize(edges>0)
    pts=np.column_stack(np.where(skeleton>0))
    return [[int(-(px-img.shape[1]//2)),int(-(img.shape[0]//2-py))] for idx,(py,px) in enumerate(pts) if idx%d==0]


def M(p):
    if len(p) > 0:
        plt.scatter([pt[0] for pt in p], [pt[1] for pt in p], s=1)
        # FLIP across y-axis fbecause for some reason it's only working with this.
        plt.gca().invert_yaxis()

        plt.show()

s = pygame.display.set_mode((W, H))
r, img, layer_img = True, None, False
P = L()

while r:
    P = L()
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            r = False
        if e.type == pygame.KEYDOWN:
            if e.key == pygame.K_w:
                img = pygame.image.load(I).convert_alpha()
                layer_img = True
            if e.key == pygame.K_t:
                P["points"].extend(A(I, d=DENSITY))
                S(P)
                M(P["points"])
                layer_img = False
            if e.key == pygame.K_UP:
                DENSITY = max(1, DENSITY - 1)
            if e.key == pygame.K_DOWN:
                DENSITY += 1

    mp = pygame.mouse.get_pressed()
    if mp[0] and not P["tracing_mode"]:
        mx, my = pygame.mouse.get_pos()
        p = [mx - CX, CY - my]
        if p not in P["points"]:
            P["points"].append(p)
            S(P)

    s.fill((255, 10, 255))
    # i wrote this while not understanding anything dont ask me debut
    if layer_img and img:
        ir, sf = img.get_rect(), min(W / img.get_width(), H / img.get_height())
        nw, nh = int(ir.width * sf), int(ir.height * sf)
        s.blit(pygame.transform.scale(img, (nw, nh)), ((CX - nw // 2), (CY - nh // 2)))
    for p in P["points"]:
        pygame.draw.circle(s, (0, 0, 0), (p[0] + CX, CY - p[1]), 1)
    # inversion
    pygame.display.flip()

pygame.quit()
